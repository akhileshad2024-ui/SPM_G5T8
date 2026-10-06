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

# Backend files each unit test file is meant to cover. Add a line when you add a test file.
TARGETS = {
    "test_us17_venue_validation": ["schemas.py"],
    "test_us17_venue_audit": ["venue_audit.py"],
    "test_us17_venue_endpoints": ["main.py"],
}


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
    include = [str(BACKEND / f) for f in files] if files else None
    buffer = io.StringIO()
    total = cov.report(include=include, file=buffer, show_missing=True)
    header = (
        f"Coverage report for {name}  (unit tests)\n"
        f"Generated: {now:%Y-%m-%d %H:%M:%S}\n"
        f"Test file: {test_file.relative_to(ROOT).as_posix()}\n"
        f"Result: {tests_run} tests, {'all passed' if passed else 'FAILURES'}\n"
        f"Measured files: {', '.join(files) if files else 'all of backend/'}\n\n"
    )
    (out / "coverage_report.txt").write_text(header + buffer.getvalue(), encoding="utf-8")
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
