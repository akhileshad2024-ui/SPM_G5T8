"""Run tests and retain each execution in a timestamped project folder."""
import argparse
import datetime as dt
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
REPORTS = ROOT / 'coverage_reports'


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def display_sgt(instant):
    return dt.datetime.fromisoformat(instant).astimezone(
        dt.timezone(dt.timedelta(hours=8))).strftime('%Y-%m-%d %H:%M:%S SGT')


def frontend_coverage_text(summary):
    lines = ['Frontend coverage by file (statement / branch / function / line %):']
    for name, values in summary.items():
        label = name if name == 'total' else os.path.relpath(name, ROOT)
        percentages = ' / '.join(str(values[key]['pct']) for key in
                                 ['statements', 'branches', 'functions', 'lines'])
        lines.append(f'{label}: {percentages}')
    lines.append('See the complete HTML report for uncovered source lines.')
    return '\n'.join(lines)


def save_record(folder, record, coverage_text=None):
    """Save readable TXT evidence alongside its precise run metadata."""
    (folder / 'run-info.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    lines = [f"{key}: {record.get(key, 'Unrecorded')}" for key in
             ['kind', 'scope', 'executor', 'sprint', 'commit', 'dirty', 'result',
              'passed', 'failed', 'skipped', 'subtests_passed']]
    lines += [f"Started: {display_sgt(record['started_at'])}",
              f"Ended: {display_sgt(record['ended_at'])}"]
    if record['kind'] in ['backend', 'frontend']:
        lines += [f"Statement coverage: {record.get('statement_percent', 'Not measured')}" + ('%' if 'statement_percent' in record else ''),
                  f"Branch coverage: {record.get('branch_percent', 'Not measured')}" + ('%' if 'branch_percent' in record else '')]
    if record.get('skip_reason'):
        lines.append('Skipped reason: ' + record['skip_reason'])
    if record.get('recording_error'):
        lines.append('Recording error: ' + record['recording_error'])
    if coverage_text:
        lines += ['', coverage_text]
    name = 'coverage_report.txt' if record['kind'] in ['backend', 'frontend'] else 'summary.txt'
    (folder / name).write_text('\n'.join(lines) + '\n', encoding='utf-8')


def run(args):
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    preset = {
        'backend': [sys.executable, '-m', 'coverage', 'run', '--branch', '--source=backend',
                    '--data-file=coverage_reports/project/latest/backend/.coverage', '-m', 'pytest', 'tests', '-v', '-ra', '-p', 'no:cacheprovider'],
        'frontend': ['npm', 'run', 'test:coverage'],
        'functional': ['npm', 'run', 'test:functional'],
    }
    if not command:
        command = preset.get(args.kind)
    if not command:
        raise SystemExit('Provide the actual command after -- for unit/integration/custom runs.')
    if args.kind == 'backend' and not args.command:
        (ROOT / 'coverage_reports/project/latest/backend').mkdir(parents=True, exist_ok=True)
    started = dt.datetime.now(dt.timezone.utc)
    record_id = f"{started.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    ci = os.getenv('GITHUB_ACTIONS') == 'true'
    base = REPORTS / 'project' / 'ci' / f"run-{os.getenv('GITHUB_RUN_ID')}-attempt-{os.getenv('GITHUB_RUN_ATTEMPT')}" if ci else REPORTS / (args.scope.lower() if re.fullmatch(r'US\d+', args.scope, re.I) else 'project') / 'history'
    session = getattr(args, 'session', None)
    folder = session / args.kind if session else base / record_id
    folder.mkdir(parents=True)
    record = dict(record_id=record_id, sprint=args.sprint, scope=args.scope, kind=args.kind,
                  executor=args.executor or os.getenv('GITHUB_ACTOR', ''), started_at=started.isoformat(),
                  timezone='UTC (convert +08:00 for SGT)', commit=os.getenv('GITHUB_SHA') or git('rev-parse', 'HEAD'),
                  dirty=bool(git('status', '--porcelain', '--untracked-files=normal', '--', '.', ':(exclude)coverage_reports')), result='Interrupted',
                  command=shlex.join(command), source='GitHub CI' if ci else 'local execution')
    if ci:
        record['ci_url'] = f"{os.getenv('GITHUB_SERVER_URL')}/{os.getenv('GITHUB_REPOSITORY')}/actions/runs/{os.getenv('GITHUB_RUN_ID')}"
        record['source'] += ': ' + record['ci_url']
    output = []
    coverage_text = None
    code = 1
    try:
        with (folder / 'test_output.txt').open('w', encoding='utf-8') as log:
            log.write(f"Started: {display_sgt(record['started_at'])}\nCommit: {record['commit']}\nScope: {record['scope']} / {record['kind']}\nCommand: {record['command']}\n\n")
            log.flush()
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
            data = ROOT / 'coverage_reports/project/latest/backend/.coverage'
            if data.exists() and data.stat().st_mtime >= started.timestamp():
                for options in [['json', '-o', 'coverage_reports/project/latest/backend/coverage.json'], ['html', '-d', 'coverage_reports/project/latest/backend/html'], ['xml', '-o', 'coverage_reports/project/latest/backend/coverage.xml']]:
                    subprocess.run([sys.executable, '-m', 'coverage', options[0], '--data-file=coverage_reports/project/latest/backend/.coverage', *options[1:]], cwd=ROOT, check=True)
                totals = json.loads((data.parent / 'coverage.json').read_text())['totals']
                record['statement_percent'] = round(100 * totals['covered_lines'] / totals['num_statements'], 2) if totals['num_statements'] else ''
                record['branch_percent'] = round(100 * totals['covered_branches'] / totals['num_branches'], 2) if totals['num_branches'] else ''
                with (data.parent / 'coverage.txt').open('w') as summary:
                    subprocess.run([sys.executable, '-m', 'coverage', 'report', '--data-file=coverage_reports/project/latest/backend/.coverage', '--show-missing'], cwd=ROOT, check=True, stdout=summary)
                coverage_text = (data.parent / 'coverage.txt').read_text()
                report = data.parent
        elif args.kind == 'frontend' and not args.command:
            summary = ROOT / 'coverage_reports/project/latest/frontend/coverage-summary.json'
            if summary.exists() and summary.stat().st_mtime >= started.timestamp():
                details = json.loads(summary.read_text())
                totals = details['total']
                coverage_text = frontend_coverage_text(details)
                record['statement_percent'] = totals['statements']['pct']
                record['branch_percent'] = totals['branches']['pct']
                report = summary.parent
        elif args.kind == 'functional' and not args.command:
            marker = ROOT / 'coverage_reports/project/latest/functional/report/index.html'
            if marker.exists() and marker.stat().st_mtime >= started.timestamp():
                report = marker.parent.parent
        if report and ci:
            # CI already uploads this report in its existing coverage_reports/project/latest/functional artifact.
            # History artifacts keep logs/manifests only, avoiding a second report ZIP.
            prefix = {'backend': 'backend-coverage', 'frontend': 'frontend-coverage', 'functional': 'functional-report'}[args.kind]
            record['report_artifact'] = f"{prefix}-{os.getenv('GITHUB_SHA')}"
        if report and not ci:
            # Preserve complete HTML/trace relationships in one ZIP; never erase source reports.
            with zipfile.ZipFile(folder / 'report.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
                for path in report.rglob('*'):
                    if path.is_file():
                        archive.write(path, path.relative_to(report))
    except Exception as error:
        record['recording_error'] = str(error)
        raise
    finally:
        record['ended_at'] = dt.datetime.now(dt.timezone.utc).isoformat()
        save_record(folder, record, coverage_text)
        log_path = folder / 'test_output.txt'
        if log_path.exists():
            with log_path.open('a', encoding='utf-8') as log:
                log.write(f"\nEnded: {display_sgt(record['ended_at'])}\nResult: {record['result']}\n")
    return code


def run_all(options=None):
    """Default team workflow: full suites, one project-level execution folder."""
    # Playwright uses the same Next.js build directory as local dev servers.
    import socket
    for port in [3000, 3100, 8100]:
        with socket.socket() as connection:
            if connection.connect_ex(('127.0.0.1', port)) == 0:
                raise SystemExit(f'Stop existing dev/test servers on port {port} before running the complete suite.')
    singapore = dt.timezone(dt.timedelta(hours=8), name='SGT')
    stamp = dt.datetime.now(singapore).strftime('%Y-%m-%d_%H-%M-%S_SGT')
    session = REPORTS / 'project' / f'{stamp}_{uuid.uuid4().hex[:8]}'
    # This is the configured Git name, not a claim of authenticated identity.
    try:
        executor = git('config', 'user.name') or 'Unrecorded'
    except subprocess.CalledProcessError:
        executor = 'Unrecorded'
    os.environ.setdefault('PYTHON', sys.executable)
    executor = getattr(options, 'executor', '') or executor
    sprint = getattr(options, 'sprint', None) or os.getenv('TEST_SPRINT', 'Unrecorded')
    failed = False
    for kind in ['backend', 'frontend', 'functional']:
        args = argparse.Namespace(command=[], kind=kind, scope='project',
                                  sprint=sprint, executor=executor, session=session)
        try:
            code = run(args)
            if code == 130:
                return 130
            failed = (code != 0) or failed
        except KeyboardInterrupt:
            return 130
        except Exception as error:
            print(f'{kind} execution/recording failed: {error}', file=sys.stderr)
            failed = True
    print(f'Complete-suite evidence: {session}')
    return 1 if failed else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action')
    complete = sub.add_parser('all', help='Run complete backend, frontend and functional suites; default when no arguments are given.')
    complete.add_argument('--sprint', default=None)
    complete.add_argument('--executor', default='')
    execute = sub.add_parser('run', help='Run a real test command and archive its result.')
    execute.add_argument('--kind', choices=['backend', 'frontend', 'functional', 'unit', 'integration', 'custom'], required=True)
    execute.add_argument('--scope', default='project')
    execute.add_argument('--sprint', default='Unrecorded')
    execute.add_argument('--executor', default='')
    execute.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.action in [None, 'all']:
        sys.exit(run_all(args))
    else:
        sys.exit(run(args))
