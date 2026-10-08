"""
Run one user story's tests under coverage and save a timestamped report.

    python run_coverage.py us17          (from the project root)

Runs every tests/**/test_us17_*.py file (unittest), or for a story with its own
folder in STORY_DIRS (e.g. us01 -> tests/us01_secure_login/) every pytest test
in that folder. Then writes, under coverage_reports/us17/<YYYY-MM-DD_HH-MM-SS>/ :

    htmlcov/index.html     browsable report (open in a browser)
    coverage_report.txt    plain-text report with the missed line numbers
    test_output.txt        the test run, one line per test
    .coverage              raw data, so the report can be regenerated

and appends a line to coverage_reports/us17/history.csv so coverage can be
compared run to run. The report covers only the backend files that story is
meant to test (STORY_FILES below); a story not listed is reported against all
of backend/.

A story listed in STORY_FRONTEND also gets its Vitest unit tests
(tests/<story folder>/*.unit.test.ts) run under coverage for those lib/ files:
frontend/coverage_report.txt and frontend/htmlcov/index.html in the same folder.
"""

import argparse
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

# Backend files each story's tests are meant to cover. Add a line when you add a story.
STORY_FILES = {
    "us01": ["login/auth.py", "login/security.py", "login/schemas.py", "login/models.py", "login/set_password.py"],
    "us02": ["login/security.py", "main.py"],
    "us17": ["main.py", "schemas.py", "models.py", "venue_audit.py"],
}

# Stories whose tests live in their own folder and run with pytest (others: unittest by file name).
STORY_DIRS = {
    "us01": "tests/us01_secure_login",
    "us02": "tests/us02_rbac",
}

# Frontend files each story's Vitest unit tests are meant to cover.
STORY_FRONTEND = {
    "us01": ["lib/idle-timeout.ts"],
    "us02": ["lib/data.ts", "lib/event-visibility.ts"],
}


def run_backend_tests(story: str, data_file: Path) -> tuple[list[Path], str, int, bool]:
    """Run the story's backend tests under coverage: (test files, output, tests run, all passed)."""
    coverage_run = [sys.executable, "-m", "coverage", "run", f"--data-file={data_file}", f"--source={BACKEND}"]

    if story in STORY_DIRS:
        folder = ROOT / STORY_DIRS[story]
        test_files = sorted(p.relative_to(ROOT) for p in folder.rglob("test_*.py"))
        run = subprocess.run(
            [*coverage_run, "-m", "pytest", str(folder), "-v", "-p", "no:cacheprovider"],
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        output = run.stdout + run.stderr
        summaries = re.findall(r"^=+ (.+) in [\d.]+s", output, flags=re.MULTILINE)  # e.g. "128 passed, 1 warning"
        counts = re.findall(r"(\d+) (?:passed|failed|errors?)\b", summaries[-1]) if summaries else []
        return test_files, output, sum(int(n) for n in counts), run.returncode == 0

    pattern = f"test_{story}_*.py"
    test_files = sorted(p.relative_to(ROOT) for p in (ROOT / "tests").rglob(pattern))
    if not test_files:
        return [], "", 0, False
    run = subprocess.run(
        [*coverage_run, "-m", "unittest", "discover", "-s", "tests", "-p", pattern, "-v"],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    output = run.stderr + run.stdout  # unittest writes to stderr
    tests_run = int(m.group(1)) if (m := re.search(r"Ran (\d+) tests?", output)) else 0
    return test_files, output, tests_run, run.returncode == 0


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
            npx, "vitest", "run", STORY_DIRS[story], "--coverage",
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Timestamped coverage report for one user story's tests.")
    parser.add_argument("story", help='story id as used in the test file names, e.g. "us17"')
    story = parser.parse_args().story.lower()

    if story not in STORY_DIRS and not any((ROOT / "tests").rglob(f"test_{story}_*.py")):
        print(f"No test files match tests/**/test_{story}_*.py")
        return 2

    now = datetime.now()
    out = REPORTS / story / now.strftime("%Y-%m-%d_%H-%M-%S")
    out.mkdir(parents=True)
    data_file = out / ".coverage"

    test_files, test_output, tests_run, passed = run_backend_tests(story, data_file)
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


if __name__ == "__main__":
    sys.exit(main())
