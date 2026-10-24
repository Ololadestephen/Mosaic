"""Pin the strict suite to reviewed scripts and fail closed on incomplete run evidence.

TestSprite does not report which script version a code replay executed, so the saved
script is checked immediately before and after the run instead.
"""
import hashlib
import json
import re
import sys
from pathlib import Path


def saved_script(directory, phase, test_id):
    data = json.loads(Path(directory, f'code-{phase}-{test_id}.json').read_text())
    data = data.get('data', data)
    return data['codeVersion'], hashlib.sha256(data['code'].encode()).hexdigest()


def check_code(pins, directory, phase):
    problems = []
    for test_id, pin in pins.items():
        try:
            version, digest = saved_script(directory, phase, test_id)
        except (OSError, ValueError, KeyError, AttributeError):
            problems.append(f'{test_id}: saved script unreadable {phase} the run')
            continue
        if (version, digest) != (pin['codeVersion'], pin['sha256']):
            problems.append(f'{test_id}: saved script {version} does not match reviewed {pin["codeVersion"]}')
    return problems


def check_runs(pins, directory, sha, origin):
    problems, runs = check_code(pins, directory, 'after'), []
    for test_id, pin in pins.items():
        try:
            data = json.loads(Path(directory, f'testsprite-run-{test_id}.json').read_text())
        except (OSError, ValueError):
            problems.append(f'{test_id}: no run result')
            continue
        run = data.get('run', data)
        replay = (run.get('replay') or {}).get('path')
        if not run.get('runId') or run.get('testId') != test_id:
            problems.append(f'{test_id}: run result lacks its run or test identity')
        if run.get('status') != 'passed':
            problems.append(f'{test_id}: status {run.get("status")}')
        if replay != 'replay':
            problems.append(f'{test_id}: not a saved-script replay ({replay})')
        runs.append({
            'runId': run.get('runId'),
            'testId': run.get('testId'),
            'testTitle': run.get('testTitle'),
            'status': run.get('status'),
            'failureKind': run.get('failureKind'),
            'error': re.sub(r'(x-vercel-protection-bypass=)[^&\s]+', r'\1[redacted]', run.get('error') or ''),
            'replayPath': replay,
            'reportedCodeVersion': run.get('codeVersion'),
            'reviewedCodeVersion': pin['codeVersion'],
            'reviewedSha256': pin['sha256'],
        })
    return problems, {'commit': sha, 'targetOrigin': origin, 'runs': runs, 'problems': problems,
                      'passed': not problems}


def main():
    mode, pins_path, directory = sys.argv[1:4]
    pins = json.loads(Path(pins_path).read_text())
    if mode == 'before':
        problems = check_code(pins, directory, 'before')
    else:
        problems, summary = check_runs(pins, directory, *sys.argv[4:6])
        Path(directory, 'testsprite-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
        print(json.dumps(summary, indent=2))
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, KeyError, TypeError, AttributeError, OSError):
        print('Missing or invalid TestSprite pin evidence; content withheld.', file=sys.stderr)
        sys.exit(1)
