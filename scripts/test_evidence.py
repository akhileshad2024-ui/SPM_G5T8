"""Record real test executions and export available evidence; never reconstruct missing runs."""
import argparse
import csv
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / 'test-reports'
FIELDS = ['record_id', 'sprint', 'scope', 'kind', 'executor', 'started_at', 'timezone',
          'commit', 'dirty', 'result', 'passed', 'failed', 'skipped', 'statement_percent',
          'branch_percent', 'legacy_coverage_percent', 'tests_run', 'test_file', 'subtests_passed', 'command', 'evidence', 'source']


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def export_history():
    records = []
    for path in sorted(REPORTS.rglob('run-info.json')):
        record = json.loads(path.read_text())
        records.append({**record, 'evidence': str(path.relative_to(ROOT))})
    # These are historical source records, not newly performed tests. Missing
    # owners, versions, Sprint and timezones remain explicitly unrecorded.
    for path in sorted((ROOT / 'coverage_reports').glob('us*/history*.csv')):
        with path.open(newline='', encoding='utf-8-sig') as stream:
            for index, old in enumerate(csv.DictReader(stream), 2):
                report = old.get('report_folder', '')
                if path.name == 'history_by_file.csv':
                    report = f"{old.get('timestamp', '').replace(' ', '_').replace(':', '-')}/{report}"
                target = path.parent / report
                records.append({
                    'record_id': hashlib.sha256(f'{path.relative_to(ROOT)}:{index}'.encode()).hexdigest()[:16],
                    'scope': path.parent.name.upper(), 'kind': old.get('type', 'backend (legacy)'),
                    'started_at': old.get('timestamp', ''), 'result': old.get('result', ''),
                    'legacy_coverage_percent': old.get('coverage_percent', ''),
                    'tests_run': old.get('tests_run', ''), 'test_file': old.get('test_file', ''),
                    'evidence': str(target.relative_to(ROOT)),
                    'source': f'legacy CSV: {path.relative_to(ROOT)}:{index}',
                })
    REPORTS.mkdir(exist_ok=True)
    target = REPORTS / 'test-run-history.csv'
    temporary = target.with_suffix('.tmp')
    with temporary.open('w', newline='', encoding='utf-8-sig') as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS, extrasaction='ignore')
        writer.writeheader()
        # A teammate's identical imported manifest is counted only once by ID.
        unique = {r['record_id']: r for r in records}
        writer.writerows(sorted(unique.values(), key=lambda r: (r.get('started_at', ''), r['record_id'])))
    temporary.replace(target)
    print(f'Exported {len(unique)} source records to {target}')


def run(args):
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    preset = {
        'backend': [sys.executable, '-m', 'coverage', 'run', '--branch', '--source=backend',
                    '--data-file=coverage/backend/.coverage', '-m', 'pytest', 'tests', '-v', '-p', 'no:cacheprovider'],
        'frontend': ['npm', 'run', 'test:coverage'],
        'functional': ['npm', 'run', 'test:functional'],
    }
    if not command:
        command = preset.get(args.kind)
    if not command:
        raise SystemExit('Provide the actual command after -- for unit/integration/custom runs.')
    started = dt.datetime.now(dt.timezone.utc)
    record_id = f"{started.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    ci = os.getenv('GITHUB_ACTIONS') == 'true'
    base = REPORTS / 'ci' / f"run-{os.getenv('GITHUB_RUN_ID')}-attempt-{os.getenv('GITHUB_RUN_ATTEMPT')}" if ci else REPORTS / 'local' / 'history'
    folder = base / record_id
    folder.mkdir(parents=True)
    record = dict(record_id=record_id, sprint=args.sprint, scope=args.scope, kind=args.kind,
                  executor=args.executor or os.getenv('GITHUB_ACTOR', ''), started_at=started.isoformat(),
                  timezone='UTC (convert +08:00 for SGT)', commit=os.getenv('GITHUB_SHA') or git('rev-parse', 'HEAD'),
                  dirty=bool(git('status', '--porcelain', '--untracked-files=normal')), result='Interrupted',
                  command=shlex.join(command), source='GitHub CI' if ci else 'local execution')
    if ci:
        record['ci_url'] = f"{os.getenv('GITHUB_SERVER_URL')}/{os.getenv('GITHUB_REPOSITORY')}/actions/runs/{os.getenv('GITHUB_RUN_ID')}"
        record['source'] += ': ' + record['ci_url']
    output = []
    code = 1
    try:
        with (folder / 'test-output.log').open('w') as log:
            child = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors='replace')
            try:
                for line in child.stdout:
                    print(line, end='', flush=True)
                    log.write(line)
                    output.append(line)
                code = child.wait()
                record['result'] = 'Pass' if code == 0 else 'Fail'
                record['exit_code'] = code
            except KeyboardInterrupt:
                child.terminate()
                child.wait()
                code = 130
        text = re.sub(r'\x1b\[[0-9;]*m', '', ''.join(output))
        subtests = re.findall(r'(\d+) subtests passed', text)
        if subtests:
            record['subtests_passed'] = int(subtests[-1])
        # Unknown counts stay blank, rather than treating a process exit as zero failures.
        for field, word in [('passed', 'passed'), ('failed', 'failed'), ('skipped', 'skipped')]:
            matches = re.findall(rf'(?<!\w)(\d+) {word}\b', text)
            if matches:
                record[field] = int(matches[-1])
        if not any(k in record for k in ['passed', 'failed', 'skipped']):
            ran = re.search(r'Ran (\d+) tests?', text)
            if ran and code == 0:
                record['passed'] = int(ran.group(1))
        report = None
        if args.kind == 'backend' and not args.command:
            # Generate reports even on test failure, from this run's fresh coverage data only.
            data = ROOT / 'coverage/backend/.coverage'
            if data.exists() and data.stat().st_mtime >= started.timestamp():
                for options in [['json', '-o', 'coverage/backend/coverage.json'], ['html', '-d', 'coverage/backend/html'], ['xml', '-o', 'coverage/backend/coverage.xml']]:
                    subprocess.run([sys.executable, '-m', 'coverage', options[0], '--data-file=coverage/backend/.coverage', *options[1:]], cwd=ROOT, check=True)
                totals = json.loads((data.parent / 'coverage.json').read_text())['totals']
                record['statement_percent'] = round(100 * totals['covered_lines'] / totals['num_statements'], 2) if totals['num_statements'] else ''
                record['branch_percent'] = round(100 * totals['covered_branches'] / totals['num_branches'], 2) if totals['num_branches'] else ''
                with (data.parent / 'coverage.txt').open('w') as summary:
                    subprocess.run([sys.executable, '-m', 'coverage', 'report', '--data-file=coverage/backend/.coverage', '--show-missing'], cwd=ROOT, check=True, stdout=summary)
                report = data.parent
        elif args.kind == 'frontend' and not args.command:
            summary = ROOT / 'coverage/frontend/coverage-summary.json'
            if summary.exists() and summary.stat().st_mtime >= started.timestamp():
                totals = json.loads(summary.read_text())['total']
                record['statement_percent'] = totals['statements']['pct']
                record['branch_percent'] = totals['branches']['pct']
                report = summary.parent
        elif args.kind == 'functional' and not args.command:
            marker = ROOT / 'coverage/functional/report/index.html'
            if marker.exists() and marker.stat().st_mtime >= started.timestamp():
                report = marker.parent.parent
        if report and ci:
            # CI already uploads this report in its existing coverage/functional artifact.
            # History artifacts keep logs/manifests only, avoiding a second report ZIP.
            prefix = {'backend': 'backend-coverage', 'frontend': 'frontend-coverage', 'functional': 'functional-report'}[args.kind]
            record['report_artifact'] = f"{prefix}-{os.getenv('GITHUB_SHA')}"
        if report and not ci:
            # Preserve complete HTML/trace relationships in one ZIP; never erase source reports.
            with zipfile.ZipFile(folder / 'report.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
                for path in report.rglob('*'):
                    if path.is_file():
                        archive.write(path, path.relative_to(report))
    finally:
        record['ended_at'] = dt.datetime.now(dt.timezone.utc).isoformat()
        (folder / 'run-info.json').write_text(json.dumps(record, indent=2) + '\n')
        export_history()
    return code


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('export', help='Combine existing manifests and legacy CSVs without rerunning tests.')
    execute = sub.add_parser('run', help='Run a real test command and archive its result.')
    execute.add_argument('--kind', choices=['backend', 'frontend', 'functional', 'unit', 'integration', 'custom'], required=True)
    execute.add_argument('--scope', default='project')
    execute.add_argument('--sprint', default='Unrecorded')
    execute.add_argument('--executor', default='')
    execute.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.action == 'export':
        export_history()
    else:
        sys.exit(run(args))
