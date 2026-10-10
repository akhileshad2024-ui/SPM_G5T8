"""
Run one user story's tests under coverage and save a timestamped report.

    python run_coverage.py us17          (from the project root)

Two kinds of story are supported:

1. Stories whose unit tests are unittest files named tests/unit/**/test_<story>_*.py
   (e.g. us17, us18). Every such file is run on its own, so each report shows what
   THAT file covers. Under coverage_reports/<story>/<YYYY-MM-DD_HH-MM-SS>/ you get:

       unit/<test_file>/htmlcov/index.html          one folder per unit test file
       unit/<test_file>/coverage_report.txt
       unit/<test_file>/test_output.txt
       summary.txt                                  one line per test file

   and one line per test file is appended to coverage_reports/<story>/history_by_file.csv
   (history.csv holds the older combined runs and is left untouched). Each test file is
   measured against the backend code it is meant to test (TARGETS below), so a unit test
   of schemas.py is not marked down for main.py; a file not listed is measured against
   all of backend/. Integration tests (tests/integration/) are not part of this mode;
   run them by hand if wanted (see README).

2. Stories with their own test folder in STORY_DIRS (e.g. us01 -> tests/us01_secure_login/),
   whose pytest tests (unit/ and API) are run together. Under
   coverage_reports/<story>/<YYYY-MM-DD_HH-MM-SS>/ you get htmlcov/index.html,
   coverage_report.txt and test_output.txt, measured against STORY_FILES, plus a line
   in coverage_reports/<story>/history.csv. A story listed in STORY_FRONTEND also gets
   its Vitest unit tests run under coverage for those lib/ files:
   frontend/coverage_report.txt and frontend/htmlcov/index.html in the same folder.
"""

import argparse
import ast
import csv
import io
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import coverage

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
REPORTS = ROOT / "coverage_reports"
UNIT_TESTS = ROOT / "tests" / "unit"

# ---------------------------------------------------------------- mode 1: one report per unit test file

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
        "main.py:search_venues",
        "schemas.py:BookedPeriod,VenueSearchRequest,AppliedFilter,VenueSearchResponse",
    ],
}

# ---------------------------------------------------------------- mode 2: one report per story folder

# Stories whose tests live in their own folder and run with pytest.
STORY_DIRS = {
    "us01": "tests/us01_secure_login",
    "us02": "tests/us02_rbac",
    "us03": "tests/us03_us04_event_request",
    "us13": "tests/us13_event_status",
}

# Backend files each of those stories' tests are meant to cover.
STORY_FILES = {
    "us01": ["login/auth.py", "login/security.py", "login/schemas.py", "login/models.py", "login/set_password.py"],
    "us02": ["login/security.py", "event_access.py", "main.py"],
    "us03": ["main.py", "schemas.py", "models.py"],
    "us13": ["event_status.py", "event_access.py", "main.py", "schemas.py", "models.py"],
}

# Frontend files each story's Vitest unit tests are meant to cover.
STORY_FRONTEND = {
    "us01": ["lib/auth/idle-timeout.ts"],
    "us02": ["lib/auth/route-access.ts", "lib/events/visibility.ts"],
    "us03": ["lib/events/request/validation.ts", "lib/events/request/api.ts",
             "lib/events/request/form-adapter.ts", "lib/events/request/submission.ts"],
    "us13": ["lib/events/status-history.ts"],
}

# Where a story's Vitest tests live, when not in its STORY_DIRS folder.
STORY_FRONTEND_TESTS = {
    "us03": "tests/unit/event-request",
}


# ---------------------------------------------------------------- mode 1 helpers

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


def run_unit_files(story: str) -> int:
    """Mode 1: one coverage report per tests/unit/**/test_<story>_*.py file."""
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


# ---------------------------------------------------------------- mode 2 helpers

def run_story_backend(story: str, data_file: Path) -> tuple:
    """Run the story folder's pytest tests under coverage: (test files, output, tests run, all passed)."""
    folder = ROOT / STORY_DIRS[story]
    test_files = sorted(p.relative_to(ROOT) for p in folder.rglob("test_*.py"))
    run = subprocess.run(
        [sys.executable, "-m", "coverage", "run", f"--data-file={data_file}", f"--source={BACKEND}",
         "-m", "pytest", str(folder), "-v", "-p", "no:cacheprovider"],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    output = run.stdout + run.stderr
    summaries = re.findall(r"^=+ (.+) in [\d.]+s", output, flags=re.MULTILINE)  # e.g. "128 passed, 1 warning"
    counts = re.findall(r"(\d+) (?:passed|failed|errors?)\b", summaries[-1]) if summaries else []
    return test_files, output, sum(int(n) for n in counts), run.returncode == 0


def run_frontend_tests(story: str, out: Path) -> str | None:
    """Vitest unit tests + coverage for the story's lib/ files; returns a one-line summary."""
    if story not in STORY_FRONTEND:
        return None
    npx = shutil.which("npx")
    if npx is None:
        return "frontend: skipped (npx not found - install Node.js and run npm install)"
    folder = out / "frontend"
    run = subprocess.run(
        [
            npx, "vitest", "run", STORY_FRONTEND_TESTS.get(story, STORY_DIRS[story]), "--coverage",
            *[f"--coverage.include={f}" for f in STORY_FRONTEND[story]],
            "--coverage.reporter=text", "--coverage.reporter=json-summary", "--coverage.reporter=html",
            f"--coverage.reportsDirectory={folder / 'htmlcov'}",
        ],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    output = re.sub(r"\x1b\[[0-9;]*m", "", run.stdout + run.stderr)  # drop terminal colours
    folder.mkdir(exist_ok=True)
    tests = m.group(0) if (m := re.search(r"Tests\s+.*", output)) else "Tests: unknown"
    summary_file = folder / "htmlcov" / "coverage-summary.json"
    lines = json.loads(summary_file.read_text())["total"]["lines"]["pct"] if summary_file.exists() else 0.0
    (folder / "coverage_report.txt").write_text(
        f"Frontend coverage for {story.upper()}\nMeasured files: {', '.join(STORY_FRONTEND[story])}\n"
        f"{tests.strip()}\nLine coverage: {lines}%\n\n{output}",
        encoding="utf-8",
    )
    result = "all passed" if run.returncode == 0 else "FAILURES"
    return f"frontend: {tests.strip()} ({result}); line coverage {lines}% of {', '.join(STORY_FRONTEND[story])}"


def run_story_folder(story: str) -> int:
    """Mode 2: one coverage report for the story's whole test folder (+ its frontend tests)."""
    now = datetime.now()
    out = REPORTS / story / now.strftime("%Y-%m-%d_%H-%M-%S")
    out.mkdir(parents=True)
    data_file = out / ".coverage"

    test_files, test_output, tests_run, passed = run_story_backend(story, data_file)
    (out / "test_output.txt").write_text(test_output, encoding="utf-8")

    cov = coverage.Coverage(data_file=str(data_file))
    cov.load()
    include = [str(BACKEND / f) for f in STORY_FILES[story]] if story in STORY_FILES else None
    buffer = io.StringIO()
    total = cov.report(include=include, file=buffer, show_missing=True)
    scope = ", ".join(STORY_FILES[story]) if include else "all of backend/"
    header = (
        f"Coverage report for {story.upper()}\n"
        f"Generated: {now:%Y-%m-%d %H:%M:%S}\n"
        f"Tests: {', '.join(p.as_posix() for p in test_files)}\n"
        f"Result: {tests_run} tests, {'all passed' if passed else 'FAILURES'}\n"
        f"Measured files: {scope}\n\n"
    )
    (out / "coverage_report.txt").write_text(header + buffer.getvalue(), encoding="utf-8")
    cov.html_report(directory=str(out / "htmlcov"), include=include, title=f"{story.upper()} coverage {now:%Y-%m-%d %H:%M}")

    history = REPORTS / story / "history.csv"
    new_file = not history.exists()
    with history.open("a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if new_file:
            writer.writerow(["timestamp", "tests_run", "result", "coverage_percent", "report_folder"])
        writer.writerow([now.strftime("%Y-%m-%d %H:%M:%S"), tests_run, "passed" if passed else "FAILED", f"{total:.1f}", out.name])

    frontend = run_frontend_tests(story, out)

    print(buffer.getvalue())
    print(f"{story.upper()}: {tests_run} tests, {'all passed' if passed else 'FAILURES - see test_output.txt'}; coverage {total:.1f}%")
    if frontend:
        print(f"{story.upper()} {frontend}")
    print(f"Report folder: {out}")
    print(f'Open it with:  start "" "{out / "htmlcov" / "index.html"}"')
    frontend_failed = frontend is not None and "FAILURES" in frontend
    return 0 if passed and not frontend_failed else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Timestamped coverage report for one user story's tests.")
    parser.add_argument("story", help='story id, e.g. "us17" (unit test files) or "us01" (story test folder)')
    story = parser.parse_args().story.lower()
    return run_story_folder(story) if story in STORY_DIRS else run_unit_files(story)


if __name__ == "__main__":
    sys.exit(main())
