import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { check } from '../src/check.js';
import { applyEdits } from '../src/cli/edits.js';
import { run, type RunDeps } from '../src/cli/run.js';
import { FETCHED_AT, fakeProvider, issue, linkedPullRequest, ok, pullRequest } from './fixtures.js';

const statuses = {
  'o/r#1': ok(
    issue({
      linkedPullRequests: [
        linkedPullRequest({ state: 'MERGED', mergedAt: '2026-09-10T00:00:00Z', release: { state: 'unreleased' } }),
      ],
    }),
  ),
  'o/r#2': ok(pullRequest({ state: 'MERGED', mergedAt: '2026-09-20T00:00:00Z', release: { state: 'unreleased' } })),
  'o/r#3': ok(issue({ number: 3 })),
  'o/r#4': ok(issue({ number: 4, state: 'CLOSED', stateReason: 'NOT_PLANNED', closedAt: '2026-09-04T00:00:00Z' })),
  'old/name#3': ok(issue({ number: 3 })),
};

const getStatuses = async (request: Parameters<ReturnType<typeof fakeProvider>>[0]) => fakeProvider(statuses)(request);

/**
 * Creates a project outside of git, so files are found by walking the directory.
 */
const project = (files: Record<string, string>) => {
  const cwd = mkdtempSync(join(tmpdir(), 'todo-watch-cli-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  return cwd;
};

const runCli = async (argv: Array<string>, cwd: string) => {
  let stdout = '';
  let stderr = '';
  const deps: RunDeps = {
    cwd,
    version: '1.2.3',
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    getStatuses,
  };
  const code = await run(argv, deps);
  return { code, stdout, stderr };
};

describe('applyEdits', () => {
  test(`should apply adjacent edits in one pass`, () => {
    // Act
    const result = applyEdits('TODO(o/r#1)', [
      { start: 5, end: 10, text: 'https://github.com/o/r/issues/1' },
      { start: 10, end: 11, text: ': x)' },
    ]);

    // Assert
    expect(result).toEqual({ text: 'TODO(https://github.com/o/r/issues/1: x)', applied: 2 });
  });

  test(`should skip overlapping edits`, () => {
    // Act
    const result = applyEdits('abcdef', [
      { start: 1, end: 4, text: 'X' },
      { start: 2, end: 5, text: 'Y' },
    ]);

    // Assert
    expect(result).toEqual({ text: 'abYf', applied: 1 });
  });
});

describe('check', () => {
  test(`should check any text file and report per file`, async () => {
    // Arrange
    const cwd = project({
      'src/a.ts': `// TODO(o/r#2)\nexport const a = 1;\n`,
      'docs/notes.md': `Waiting for TODO(o/r#1).\n`,
      'scripts/run.py': `# TODO(https://github.com/o/r/issue/3)\n`,
      'node_modules/dep/index.js': `// TODO(o/r#2)\n`,
    });

    // Act
    const result = await check({ cwd, getStatuses });

    // Assert
    expect(result.refCount).toBe(2);
    expect(result.files.map((file) => [file.path, file.findings.map((finding) => finding.messageId)])).toEqual([
      ['docs/notes.md', ['linkedMerged']],
      ['scripts/run.py', ['invalidRef']],
      ['src/a.ts', ['merged']],
    ]);
  });

  test(`should check only the given references and rules`, async () => {
    // Arrange
    const cwd = project({ 'a.ts': `// TODO(o/r#1)\n// TODO(o/r#2)\n// TODO(o/r#3)\n` });

    // Act
    const result = await check({
      cwd,
      getStatuses,
      refs: [{ owner: 'o', repo: 'r', number: 2 }],
      rules: ['pull-request'],
    });

    // Assert
    expect(result.refCount).toBe(1);
    expect(result.files[0]?.findings.map((finding) => finding.messageId)).toEqual(['merged']);
  });

  test(`should report unavailable statuses once per run`, async () => {
    // Arrange
    const cwd = project({ 'a.ts': `// TODO(x/y#1)\n`, 'b.ts': `// TODO(x/y#2)\n` });
    const failure = {
      ok: false,
      reason: 'unavailable',
      message: 'No GitHub token found.',
      fetchedAt: FETCHED_AT,
    } as const;

    // Act
    const result = await check({
      cwd,
      getStatuses: async () => ({ 'x/y#1': failure, 'x/y#2': failure }),
    });

    // Assert
    const messageIds = result.files.flatMap((file) => file.findings.map((finding) => finding.messageId));
    expect(messageIds).toEqual(['unavailable']);
  });
});

describe('run', () => {
  test(`should print a text report and fail on errors`, async () => {
    // Arrange
    const cwd = project({ 'a.ts': `// TODO(o/r#2)\n// TODO(old/name#3)\n` });

    // Act
    const { code, stdout } = await runCli([], cwd);

    // Assert
    expect(code).toBe(1);
    expect(stdout).toBe(
      [
        'a.ts:1:9  warning  pull-request',
        '  o/r#2 "Fix crash on start" was merged on 2026-09-20, not released yet.',
        '  URL: https://github.com/o/r/pull/2',
        '  Next: keep the comment until a release contains the fix, then upgrade and remove the comment.',
        '',
        'a.ts:2:9  error  invalid',
        '  old/name#3 has moved to o/r#3 "Crash on start".',
        '  URL: https://github.com/o/r/issues/3',
        '  Next: run `todo-watch --fix`, or replace "old/name#3" with "o/r#3".',
        '',
        '2 problems (1 error, 1 warning) in 2 references. 1 can be fixed with --fix.',
        '',
      ].join('\n'),
    );
  });

  test(`should pass without problems`, async () => {
    // Arrange
    const cwd = project({ 'a.ts': `// TODO(o/r#3)\n` });

    // Act
    const { code, stdout } = await runCli([], cwd);

    // Assert
    expect(code).toBe(0);
    expect(stdout).toBe('No problems found in 1 reference.\n');
  });

  test.each([
    [['--fail-on', 'warn'], 1],
    [['--fail-on', 'none', '--rules', 'issue'], 0],
    [['--fail-on', 'error'], 0],
  ])(`should use fail level %j`, async (argv, expected) => {
    // Arrange
    const cwd = project({ 'a.ts': `// TODO(o/r#2)\n` });

    // Act
    const { code } = await runCli(argv, cwd);

    // Assert
    expect(code).toBe(expected);
  });

  test(`should print json`, async () => {
    // Arrange
    const cwd = project({ 'a.ts': `// TODO(o/r#1)\n` });

    // Act
    const { stdout } = await runCli(['--format', 'json'], cwd);

    // Assert
    const report = JSON.parse(stdout);
    expect(report.refCount).toBe(1);
    expect(report.warningCount).toBe(1);
    expect(report.problems[0]).toEqual({
      file: 'a.ts',
      line: 1,
      column: 9,
      severity: 'warn',
      rule: 'issue',
      messageId: 'linkedMerged',
      ref: 'o/r#1',
      summary:
        'o/r#1 "Crash on start" is still open, but the linked pull request o/r#5 "Fix the crash" was merged on 2026-09-10, not released yet.',
      details: [
        'URL: https://github.com/o/r/pull/5',
        'Next: keep the comment until a release contains the fix, then upgrade and remove the comment.',
      ],
      fixable: false,
      suggestions: [],
    });
  });

  test(`should print markdown`, async () => {
    // Arrange
    const cwd = project({ 'a.ts': `// TODO(o/r#2)\n` });

    // Act
    const { stdout } = await runCli(['--format', 'markdown', '--compact'], cwd);

    // Assert
    expect(stdout).toBe(
      [
        '## todo-watch',
        '',
        '### `a.ts`',
        '',
        '- **warning** `pull-request` [line 1](a.ts#L1): o/r#2 "Fix crash on start" was merged on 2026-09-20, not released yet.',
        '',
        '1 problem (0 errors, 1 warning) in 1 reference.',
        '',
      ].join('\n'),
    );
  });

  test(`should print only errors with --quiet`, async () => {
    // Arrange
    const cwd = project({ 'a.ts': `// TODO(o/r#2)\n// TODO(old/name#3)\n` });

    // Act
    const { stdout } = await runCli(['--quiet', '--compact'], cwd);

    // Assert
    expect(stdout.split('\n')[0]).toBe('a.ts:2:9  error  invalid  old/name#3 has moved to o/r#3 "Crash on start".');
    expect(stdout).not.toContain('pull-request');
  });

  test(`should fix files`, async () => {
    // Arrange
    const cwd = project({
      'a.ts': '// TODO(old/name#3): use the new option\n// TODO(https://github.com/old/name/issues/3#issuecomment-1)\n',
    });

    // Act
    const { code, stderr } = await runCli(['--fix'], cwd);

    // Assert
    expect(code).toBe(0);
    expect(stderr).toBe('Applied 2 changes.\n');
    expect(readFileSync(join(cwd, 'a.ts'), 'utf8')).toBe(
      '// TODO(o/r#3): use the new option\n// TODO(https://github.com/o/r/issues/3#issuecomment-1)\n',
    );
  });

  test.each([
    [['--issue-states', 'completed,duplicate'], ''],
    [['--no-linked-prs'], 'a.ts:2:9'],
    [[], 'a.ts:1:9'],
  ])(`should select issue checks with %j`, async (argv, expected) => {
    // Arrange
    const cwd = project({ 'a.ts': '// TODO(o/r#1)\n// TODO(o/r#4)\n' });

    // Act
    const { stdout } = await runCli([...argv, '--compact'], cwd);

    // Assert
    expect(stdout.split('\n')[0]?.startsWith(expected)).toBe(true);
  });

  test(`should select pull request states`, async () => {
    // Arrange
    const cwd = project({ 'a.ts': '// TODO(o/r#2)\n' });

    // Act
    const { stdout } = await runCli(['--pr-states', 'closed'], cwd);

    // Assert
    expect(stdout).toBe('No problems found in 1 reference.\n');
  });

  test.each([
    [['--format', 'xml'], 'Invalid value "xml" for --format. Use one of: text, json, markdown.'],
    [['--rules', 'issue,foo'], 'Invalid value "foo" for --rules. Use one of: invalid, issue, pull-request.'],
    [['--pr-states', 'open'], 'Invalid value "open" for --pr-states. Use one of: merged, closed.'],
    [['--ref', 'o/r'], 'Invalid reference "o/r". Use owner/repo#123 or a GitHub URL.'],
    [['--cache-ttl', 'abc'], 'Invalid value "abc" for --cache-ttl. Use a number of minutes.'],
  ])(`should reject %j`, async (argv, message) => {
    // Arrange
    const cwd = project({});

    // Act
    const { code, stderr } = await runCli(argv, cwd);

    // Assert
    expect(code).toBe(2);
    expect(stderr).toBe(`${message}\nRun todo-watch --help for usage.\n`);
  });

  test(`should reject unknown options`, async () => {
    // Arrange
    const cwd = project({});

    // Act
    const { code, stderr } = await runCli(['--nope'], cwd);

    // Assert
    expect(code).toBe(2);
    expect(stderr).toContain("Unknown option '--nope'");
  });

  test(`should print help and version`, async () => {
    // Arrange
    const cwd = project({});

    // Act
    const help = await runCli(['--help'], cwd);
    const version = await runCli(['-v'], cwd);

    // Assert
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage: todo-watch [options] [paths...]');
    expect(version.stdout).toBe('1.2.3\n');
  });
});

describe('check in a git repository', () => {
  test(`should skip node_modules without a .gitignore`, async () => {
    // Arrange
    const cwd = project({
      'a.ts': `// TODO(o/r#3)\n`,
      'node_modules/dep/index.js': `// TODO(o/r#3)\n`,
      'packages/app/node_modules/dep/index.js': `// TODO(o/r#3)\n`,
    });
    execFileSync('git', ['init', '-q'], { cwd });

    // Act
    const result = await check({ cwd, getStatuses });

    // Assert
    expect(result.files.map((file) => file.path)).toEqual(['a.ts']);
  });
});

describe('run with local references', () => {
  test(`should resolve #123 with --repo`, async () => {
    // Arrange
    const cwd = project({ 'a.ts': `// TODO(#2)\n` });

    // Act
    const { stdout } = await runCli(['--repo', 'o/r', '--compact'], cwd);

    // Assert
    expect(stdout.split('\n')[0]).toBe(
      'a.ts:1:9  warning  pull-request  o/r#2 "Fix crash on start" was merged on 2026-09-20, not released yet.',
    );
  });
});
