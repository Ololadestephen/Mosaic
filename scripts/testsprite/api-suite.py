"""Run the reviewed TestSprite API tests (tests/testsprite-api/*.py) against production and fail closed on drift.

The files in Git are the reviewed source. Each cloud test is brought to the exact file content before the run,
re-read after it, and the run must be a fresh pass started during this workflow attempt.
Usage: api-suite.py <sha> <not-before-iso> <out-dir>; TESTSPRITE_API_TESTS maps file names to test IDs.
"""
import hashlib
import json
import os
import shlex
import subprocess
import sys
from datetime import datetime
from pathlib import Path

CLI = shlex.split(os.environ.get('TESTSPRITE_CLI', 'npx -y @testsprite/testsprite-cli@0.2.0'))
SOURCE = Path(os.environ.get('TESTSPRITE_API_DIR', 'tests/testsprite-api'))


def cli(*args):
    result = subprocess.run([*CLI, '--output', 'json', *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f'testsprite {args[0]} {args[1]} exited {result.returncode}')
    data = json.loads(result.stdout)
    return data.get('data', data)


# TestSprite prepends this block to stored backend code for a public (credential-free) project and drops the final
# newline. Exactly this block is accepted; any other prefix, credential or header makes the code differ.
PUBLIC_PREAMBLE = (
    '# Auto-injected credentials — redacted for security; set TESTSPRITE_AUTH_CREDENTIAL to run this locally\n'
    '__AUTH_CREDENTIAL__ = __import__("os").environ.get("TESTSPRITE_AUTH_CREDENTIAL", "")\n'
    '__AUTH_TYPE__ = "public"\n'
    '__EXTRA_HEADERS__ = {}\n'
    '__AUTH_HEADERS__ = {}\n'
)


def digest(text):
    if text.startswith(PUBLIC_PREAMBLE):
        text = text[len(PUBLIC_PREAMBLE):]
    return hashlib.sha256(text.rstrip('\n').encode()).hexdigest()


def stored(test_id):
    data = cli('test', 'code', 'get', test_id)
    return data['codeVersion'], digest(data['code'])


def instant(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def main():
    sha, not_before, out = sys.argv[1:4]
    tests = json.loads(os.environ['TESTSPRITE_API_TESTS'])
    files = sorted(path.name for path in SOURCE.glob('*.py'))
    if sorted(tests) != files:
        raise SystemExit(f'Configured tests {sorted(tests)} do not match reviewed files {files}')
    problems, runs = [], []
    for name, test_id in sorted(tests.items()):
        reviewed = digest((SOURCE / name).read_text())
        version, current = stored(test_id)
        if current != reviewed:
            cli('test', 'code', 'put', test_id, '--code-file', str(SOURCE / name), '--expected-version', version)
            version, current = stored(test_id)
        if current != reviewed:
            problems.append(f'{name}: stored code does not match the reviewed file')
            continue
        key = f'mosaic-api-{sha}-{os.environ.get("GITHUB_RUN_ID", "local")}-{os.environ.get("GITHUB_RUN_ATTEMPT", "1")}-{test_id}'
        try:
            run = cli('test', 'run', test_id, '--wait', '--timeout', '600', '--idempotency-key', key)
        except (RuntimeError, ValueError) as error:
            run = {'status': 'failed', 'error': str(error)}
        run = run.get('run', run)
        after_version, after = stored(test_id)
        if run.get('status') != 'passed':
            problems.append(f'{name}: status {run.get("status")}')
        if not run.get('runId') or run.get('testId') != test_id:
            problems.append(f'{name}: run result lacks its run or test identity')
        try:
            if instant(run['startedAt']) < instant(not_before):
                problems.append(f'{name}: result predates this attempt')
        except (KeyError, TypeError, AttributeError, ValueError):
            problems.append(f'{name}: run result lacks a valid start time')
        if (after_version, after) != (version, reviewed):
            problems.append(f'{name}: stored code changed during the run')
        runs.append({'file': name, 'testId': test_id, 'runId': run.get('runId'), 'status': run.get('status'),
                     'startedAt': run.get('startedAt'), 'failureKind': run.get('failureKind'),
                     'codeVersion': version, 'sha256': reviewed})
    summary = {'commit': sha, 'target': 'production', 'notBefore': not_before, 'runs': runs,
               'problems': problems, 'passed': not problems}
    Path(out, 'testsprite-api-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary, indent=2))
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (KeyError, ValueError, OSError, RuntimeError) as error:
        print(f'TestSprite API suite could not run: {type(error).__name__}; content withheld.', file=sys.stderr)
        sys.exit(1)
