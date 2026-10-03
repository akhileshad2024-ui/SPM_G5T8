"""
Run one user story's tests under coverage and save a timestamped report.

    python run_coverage.py us17          (from the project root)

Runs every tests/**/test_us17_*.py file, then writes, under
coverage_reports/us17/<YYYY-MM-DD_HH-MM-SS>/ :

    htmlcov/index.html     browsable report (open in a browser)
    coverage_report.txt    plain-text report with the missed line numbers
    test_output.txt        the unittest run, one line per test
    .coverage              raw data, so the report can be regenerated

and appends a line to coverage_reports/us17/history.csv so coverage can be
compared run to run. The report covers only the backend files that story is
meant to test (STORY_FILES below); a story not listed is reported against all
of backend/.
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

# Backend files each story's tests are meant to cover. Add a line when you add a story.
STORY_FILES = {
    "us17": ["main.py", "schemas.py", "models.py", "venue_audit.py"],
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Timestamped coverage report for one user story's tests.")
    parser.add_argument("story", help='story id as used in the test file names, e.g. "us17"')
    story = parser.parse_args().story.lower()

    pattern = f"test_{story}_*.py"
    test_files = sorted(p.relative_to(ROOT) for p in (ROOT / "tests").rglob(pattern))
    if not test_files:
        print(f"No test files match tests/**/{pattern}")
        return 2

    now = datetime.now()
    out = REPORTS / story / now.strftime("%Y-%m-%d_%H-%M-%S")
    out.mkdir(parents=True)
    data_file = out / ".coverage"

    run = subprocess.run(
        [
            sys.executable, "-m", "coverage", "run", f"--data-file={data_file}", f"--source={BACKEND}",
            "-m", "unittest", "discover", "-s", "tests", "-p", pattern, "-v",
        ],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    test_output = run.stderr + run.stdout  # unittest writes to stderr
    (out / "test_output.txt").write_text(test_output, encoding="utf-8")
    tests_run = int(m.group(1)) if (m := re.search(r"Ran (\d+) tests?", test_output)) else 0
    passed = run.returncode == 0

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

    print(buffer.getvalue())
    print(f"{story.upper()}: {tests_run} tests, {'all passed' if passed else 'FAILURES - see test_output.txt'}; coverage {total:.1f}%")
    print(f"Report folder: {out}")
    print(f'Open it with:  start "" "{out / "htmlcov" / "index.html"}"')
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
