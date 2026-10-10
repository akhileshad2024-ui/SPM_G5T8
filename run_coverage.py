"""
Run one user story's UNIT tests under coverage, one test file at a time, and save
a timestamped report for each file.

    python run_coverage.py us17          (from the project root)

Every tests/unit/**/test_us17_*.py file is run on its own, so each report shows
what THAT file covers. Under coverage_reports/us17/<YYYY-MM-DD_HH-MM-SS>/ you get:

    unit/<test_file>/htmlcov/index.html          one folder per unit test file
    unit/<test_file>/coverage_report.txt
    unit/<test_file>/test_output.txt
    summary.txt                                  one line per test file

and one line per test file is appended to coverage_reports/us17/history_by_file.csv
(history.csv holds the older combined runs and is left untouched).

Integration tests (tests/integration/) are not part of this automation; run them
by hand if wanted (see README).

Each test file is measured against the backend files it is meant to test
(TARGETS below), so a unit test of schemas.py is not marked down for main.py.
A test file not listed is measured against all of backend/.
"""

import argparse
import ast
import csv
import io
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import coverage

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
REPORTS = ROOT / "coverage_reports"
UNIT_TESTS = ROOT / "tests" / "unit"

# What each unit test file is meant to cover. Add a line when you add a test file.
#   "schemas.py"                          the whole file
#   "main.py:create_venue,update_venue"   only those top-level functions/classes of the file
# The second form is for files shared by several stories (main.py holds US17 and US18 endpoints),
# so each story is measured only on its own code.
TARGETS = {
    "test_us17_venue_validation": ["schemas.py:VenueCreate,VenueUpdate,UnavailabilityPeriod"],
    "test_us17_venue_audit": ["venue_audit.py"],
    "test_us17_venue_endpoints": ["main.py:create_venue,update_venue,delete_venue,get_venue_history"],
    "test_us18_view_venue_details": ["main.py:get_venues,get_venue", "schemas.py:VenueResponse"],
    "test_us20_search_filter_venues": [
        "venue_search.py",
        "venue_availability.py",
        "main.py:search_venues",
        "schemas.py:BookedPeriod,TimingFields,VenueSearchRequest,AppliedFilter,VenueSearchResponse,_blank_to_none,_clean_layout,_end_after_start",
    ],
    "test_us21_check_venue_suitability": [
        "venue_suitability.py",
        "venue_availability.py:availability_issues,describe_window,format_clock,format_date,format_stamp,to_datetime",
        "main.py:check_venue_suitability",
        "schemas.py:SuitabilityRequest,RequirementCheck,VenueSuitability,SuitabilityResponse,UnmetRequirement,BookingOverride",
    ],
    "test_us22_submit_booking_request": [
        "booking_request.py",
        "main.py:request_venue_booking",
        "schemas.py:BookingRequestCreate,VenueBooking,BookingNotification,BookingRequestResponse",
    ],
}


def split_target(spec: str) -> tuple:
    """"main.py:a,b" -> ("main.py", ["a", "b"]); "schemas.py" -> ("schemas.py", [])."""
    file, _, names = spec.partition(":")
    return file, [n for n in names.split(",") if n]


def lines_of(path: Path, names: list) -> set:
    """Line numbers of the named top-level functions/classes, decorators included."""
    nodes = {n.name: n for n in ast.parse(path.read_text(encoding="utf-8")).body
             if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}
    unknown = [n for n in names if n not in nodes]
    if unknown:
        raise SystemExit(f"{path.name} has no top-level function or class named: {', '.join(unknown)}")
    lines = set()
    for name in names:
        node = nodes[name]
        lines.update(range(min([node.lineno] + [d.lineno for d in node.decorator_list]), node.end_lineno + 1))
    return lines


def as_ranges(numbers: list) -> str:
    """[1, 2, 3, 7] -> "1-3, 7"."""
    groups = []
    for n in numbers:
        if groups and n == groups[-1][1] + 1:
            groups[-1][1] = n
        else:
            groups.append([n, n])
    return ", ".join(str(a) if a == b else f"{a}-{b}" for a, b in groups)


def targeted_report(cov, specs: list) -> tuple:
    """A coverage table limited to the targeted code. Returns (text, overall percent)."""
    rows, total_statements, total_missed = [], 0, 0
    for spec in specs:
        file, names = split_target(spec)
        path = BACKEND / file
        _, statements, _, missing, _ = cov.analysis2(str(path))
        if names:
            wanted = lines_of(path, names)
            statements = [n for n in statements if n in wanted]
            missing = [n for n in missing if n in wanted]
        total_statements += len(statements)
        total_missed += len(missing)
        percent = 100.0 if not statements else 100.0 * (len(statements) - len(missing)) / len(statements)
        rows.append((spec, len(statements), len(missing), percent, as_ranges(sorted(missing))))
    width = max(len("Name"), *(len(r[0]) for r in rows))
    out = [f"{'Name':<{width}}  Stmts  Miss  Cover  Missing", "-" * (width + 32)]
    for spec, statements, missed, percent, missing in rows:
        out.append(f"{spec:<{width}}  {statements:>5}  {missed:>4}  {percent:>4.0f}%  {missing}")
    overall = 100.0 if not total_statements else 100.0 * (total_statements - total_missed) / total_statements
    out += ["-" * (width + 32), f"{'TOTAL':<{width}}  {total_statements:>5}  {total_missed:>4}  {overall:>4.0f}%"]
    return "\n".join(out) + "\n", overall


def run_one(test_file: Path, stamp_dir: Path, now: datetime) -> dict:
    """Run a single unit test file under coverage and write its report folder."""
    name = test_file.stem
    out = stamp_dir / "unit" / name
    out.mkdir(parents=True)
    data_file = out / ".coverage"
    module = ".".join(test_file.relative_to(ROOT).with_suffix("").parts)

    run = subprocess.run(
        [
            sys.executable, "-m", "coverage", "run", f"--data-file={data_file}", f"--source={BACKEND}",
            "-m", "unittest", module, "-v",
        ],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    test_output = run.stderr + run.stdout  # unittest writes to stderr
    (out / "test_output.txt").write_text(test_output, encoding="utf-8")
    tests_run = int(m.group(1)) if (m := re.search(r"Ran (\d+) tests?", test_output)) else 0
    passed = run.returncode == 0

    cov = coverage.Coverage(data_file=str(data_file))
    cov.load()
    files = TARGETS.get(name)
    include = [str(BACKEND / split_target(f)[0]) for f in files] if files else None
    if files:
        table, total = targeted_report(cov, files)
    else:
        buffer = io.StringIO()
        total = cov.report(include=include, file=buffer, show_missing=True)
        table = buffer.getvalue()
    header = (
        f"Coverage report for {name}  (unit tests)\n"
        f"Generated: {now:%Y-%m-%d %H:%M:%S}\n"
        f"Test file: {test_file.relative_to(ROOT).as_posix()}\n"
        f"Result: {tests_run} tests, {'all passed' if passed else 'FAILURES'}\n"
        f"Measured code: {', '.join(files) if files else 'all of backend/'}\n\n"
    )
    (out / "coverage_report.txt").write_text(header + table, encoding="utf-8")
    cov.html_report(directory=str(out / "htmlcov"), include=include, title=f"{name} coverage {now:%Y-%m-%d %H:%M}")
    return {"kind": "unit", "name": name, "tests": tests_run, "passed": passed, "coverage": total, "folder": out}


def main() -> int:
    parser = argparse.ArgumentParser(description="Timestamped unit-test coverage report per test file for one user story.")
    parser.add_argument("story", help='story id as used in the test file names, e.g. "us17"')
    story = parser.parse_args().story.lower()

    pattern = f"test_{story}_*.py"
    found = sorted(UNIT_TESTS.rglob(pattern))
    if not found:
        print(f"No unit test files match tests/unit/**/{pattern}")
        return 2

    now = datetime.now()
    stamp_dir = REPORTS / story / now.strftime("%Y-%m-%d_%H-%M-%S")
    results = [run_one(test_file, stamp_dir, now) for test_file in found]

    lines = [f"{story.upper()} unit test and coverage summary - {now:%Y-%m-%d %H:%M:%S}", ""]
    lines.append(f"{'type':<8}{'test file':<34}{'tests':>6}  {'result':<8}{'coverage':>9}")
    for r in results:
        lines.append(f"{r['kind']:<8}{r['name']:<34}{r['tests']:>6}  {'passed' if r['passed'] else 'FAILED':<8}{r['coverage']:>8.1f}%")
    summary = "\n".join(lines) + "\n"
    (stamp_dir / "summary.txt").write_text(summary, encoding="utf-8")

    history = REPORTS / story / "history_by_file.csv"
    new_file = not history.exists()
    with history.open("a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if new_file:
            writer.writerow(["timestamp", "type", "test_file", "tests_run", "result", "coverage_percent", "report_folder"])
        for r in results:
            writer.writerow([now.strftime("%Y-%m-%d %H:%M:%S"), r["kind"], r["name"], r["tests"],
                             "passed" if r["passed"] else "FAILED", f"{r['coverage']:.1f}", f"unit/{r['name']}"])

    print(summary)
    print(f"Report folder: {stamp_dir}")
    print(f'Open one with:  start "" "{results[0]["folder"] / "htmlcov" / "index.html"}"')
    return 0 if all(r["passed"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
