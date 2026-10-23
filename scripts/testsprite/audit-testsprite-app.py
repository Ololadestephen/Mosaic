"""Conservative export checks; these supplement run and database evidence."""
import ast
import json
import sys
from pathlib import Path


def inspect_code(code, kind, expected):
    tree = ast.parse(code)
    roots = [n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'run_test']
    if len(roots) != 1:
        return {'recognised_test_entry': False}
    active = roots[0]
    calls = [n.value for n in ast.walk(active) if isinstance(n, ast.Await) and isinstance(n.value, ast.Call)]
    assertions = [n for n in calls if isinstance(n.func, ast.Attribute)
                  and n.func.attr.startswith(('to_', 'not_to_'))]
    bindings = {n.targets[0].id: n.value for n in ast.walk(tree)
                if isinstance(n, ast.Assign) and len(n.targets) == 1
                and isinstance(n.targets[0], ast.Name)}

    def text(node, seen=frozenset()):
        parts = [n.value for n in ast.walk(node)
                 if isinstance(n, ast.Constant) and isinstance(n.value, str)]
        for n in ast.walk(node):
            if isinstance(n, ast.Name) and n.id in bindings and n.id not in seen:
                parts.append(text(bindings[n.id], seen | {n.id}))
        return '\n'.join(parts)

    def asserted(value, after=0):
        return any(n.lineno > after and value in text(n) for n in assertions)

    reloads = sorted(n.lineno for n in calls if isinstance(n.func, ast.Attribute)
                     and n.func.attr == 'reload')
    checks = {'explicit_refresh': len(reloads) >= (2 if kind == 'taskSource' else 1)}
    refresh = reloads[0] if reloads else 10**9
    if kind == 'session':
        checks.update(exact_sha=asserted(expected['sha']),
                      health_read=any(isinstance(n.func, ast.Attribute) and n.func.attr == 'goto' and '/api/health' in text(n) for n in calls),
                      refreshed_workspace=(asserted(expected['workspace'], refresh) or bool(expected.get('workspaceId') and asserted(expected['workspaceId'], refresh))),
                      logout_denial=asserted('/login', refresh))
    elif kind == 'taskSource':
        checks.update(task_date_after_refresh=asserted('2026-11-05', refresh),
                      original_source=asserted(expected['manualV1']),
                      revised_source_after_refresh=asserted(expected['manualV2'], reloads[-1] if reloads else refresh),
                      historical_notice=asserted('historical revision'))
    else:
        checks.update(exact_quote=asserted(expected['deadlineQuote']),
                      labelled_fixture=asserted('not live AI'),
                      receipt_after_refresh=asserted('Applied changes', refresh),
                      undo_restore=asserted('1 fields restored or tasks archived.'),
                      undo_conflict=asserted('1 conflicts preserved.'),
                      unselected_status=asserted('todo', refresh),
                      later_edit_revision=asserted('Revision 4', refresh))
        checks['created_task_absent'] = any(
            n.func.attr == 'to_have_count' and expected['createdTaskTitle'] in text(n)
            and n.args and isinstance(n.args[0], ast.Constant) and n.args[0].value == 0
            for n in assertions)
    return checks


def main():
    expected = json.loads(Path(sys.argv[1]).read_text())
    results = {}
    for kind in ['session', 'taskSource', 'review']:
        exported = json.loads(Path(sys.argv[2], f'{kind}-code.json').read_text())
        results[kind] = inspect_code(exported['code'], kind, expected)
    print(json.dumps({'checks': results, 'passed': all(all(v.values()) for v in results.values()),
                      'scope': 'necessary export checks; not a substitute for runtime or human review'}))
    return 0 if all(all(v.values()) for v in results.values()) else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, KeyError, SyntaxError, OSError, IndexError):
        print(json.dumps({'passed': False, 'reason': 'Missing or invalid export evidence; content withheld.'}))
        sys.exit(1)
