import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { check } from '../src/check.js';
import { applyEdits } from '../src/cli/edits.js';
import { run, type RunDeps } from '../src/cli/run.js';
import { FETCHED_AT, fakeProvider, issue, ok, pullRequest } from './fixtures.js';

const NOW = new Date('2026-09-28T12:00:00Z');
const SEEN = 'seen=2026-09-01T00:00Z';

const statuses = {
  'o/r#1': ok(
    issue({
      comments: [
        {
          url: 'https://github.com/o/r/issues/1#issuecomment-9',
          createdAt: '2026-09-10T00:00:00Z',
          body: 'Fixed in main',
          author: { login: 'alice', isBot: false },
        },
      ],
    }),
  ),
  'o/r#2': ok(pullRequest({ state: 'MERGED', mergedAt: '2026-09-20T00:00:00Z', release: { state: 'unreleased' } })),
  'o/r#3': ok(issue({ number: 3 })),
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
    now: NOW,
  };
  const code = await run(argv, deps);
  return { code, stdout, stderr };
};

describe('applyEdits', () => {
  test(`should apply adjacent edits in one pass`, () => {
    // Act
    const result = applyEdits('TODO(o/r#1)', [
      { start: 5, end: 10, text: 'https://github.com/o/r/issues/1' },
      { start: 10, end: 10, text: ' seen=x' },
    ]);

    // Assert
    expect(result).toEqual({ text: 'TODO(https://github.com/o/r/issues/1 seen=x)', applied: 2 });
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
      'src/a.ts': `// TODO(o/r#2 ${SEEN})\nexport const a = 1;\n`,
      'docs/notes.md': `Waiting for TODO(o/r#1 ${SEEN}).\n`,
      'scripts/run.py': `# FIXME(o/r#3)\n`,
      'node_modules/dep/index.js': `// TODO(o/r#2 ${SEEN})\n`,
    });

    // Act
    const result = await check({ cwd, getStatuses, now: NOW });

    // Assert
    expect(result.refCount).toBe(3);
    expect(result.files.map((file) => [file.path, file.findings.map((finding) => finding.messageId)])).toEqual([
      ['docs/notes.md', ['activity']],
      ['scripts/run.py', ['missingSeen']],
      ['src/a.ts', ['merged']],
    ]);
  });

  test(`should check only the given references and rules`, async () => {
    // Arrange
    const cwd = project({ 'a.ts': `// TODO(o/r#1 ${SEEN})\n// TODO(o/r#2 ${SEEN})\n// TODO(o/r#3)\n` });

    // Act
    const result = await check({
      cwd,
      getStatuses,
      now: NOW,
      refs: [{ owner: 'o', repo: 'r', number: 2 }],
      rules: ['resolved'],
    });

    // Assert
    expect(result.refCount).toBe(1);
    expect(result.files[0]?.findings.map((finding) => finding.messageId)).toEqual(['merged']);
  });

  test(`should report unavailable statuses once per run`, async () => {
    // Arrange
    const cwd = project({ 'a.ts': `// TODO(x/y#1 ${SEEN})\n`, 'b.ts': `// TODO(x/y#2 ${SEEN})\n` });
    const failure = {
      ok: false,
      reason: 'unavailable',
      message: 'No GitHub token found.',
      fetchedAt: FETCHED_AT,
    } as const;

    // Act
    const result = await check({
      cwd,
      now: NOW,
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
    const cwd = project({ 'a.ts': `// TODO(o/r#2 ${SEEN})\n// TODO(o/r#3)\n` });

    // Act
    const { code, stdout } = await runCli([], cwd);

    // Assert
    expect(code).toBe(1);
    expect(stdout).toBe(
      [
        'a.ts:1:9  warning  resolved',
        '  o/r#2 "Fix crash on start" was merged on 2026-09-20, not released yet.',
        '  URL: https://github.com/o/r/pull/2',
        '  Next: keep the workaround until a release contains the fix. Then upgrade and remove the TODO and its workaround.',
        '',
        'a.ts:2:9  error  format',
        '  Missing seen marker for "o/r#3". Add " seen=2026-09-28T12:00Z" after the reference, or run `todo-watch --fix`.',
        '',
        '2 problems (1 error, 1 warning) in 2 references. 1 can be fixed with --fix.',
        '',
      ].join('\n'),
    );
  });

  test(`should pass without problems`, async () => {
    // Arrange
    const cwd = project({ 'a.ts': `// TODO(o/r#3 ${SEEN})\n` });

    // Act
    const { code, stdout } = await runCli([], cwd);

    // Assert
    expect(code).toBe(0);
    expect(stdout).toBe('No problems found in 1 reference.\n');
  });

  test.each([
    [['--fail-on', 'warn'], 1],
    [['--fail-on', 'none', '--rules', 'format'], 0],
    [['--fail-on', 'error'], 0],
  ])(`should use fail level %j`, async (argv, expected) => {
    // Arrange
    const cwd = project({ 'a.ts': `// TODO(o/r#2 ${SEEN})\n` });

    // Act
    const { code } = await runCli(argv, cwd);

    // Assert
    expect(code).toBe(expected);
  });

  test(`should print json`, async () => {
    // Arrange
    const cwd = project({ 'a.ts': `// TODO(o/r#1 ${SEEN})\n` });

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
      rule: 'activity',
      messageId: 'activity',
      ref: 'o/r#1',
      summary: 'o/r#1 "Crash on start" was updated since 2026-09-01T00:00Z: 1 new comment.',
      details: [
        'First new comment by alice on 2026-09-10: "Fixed in main"',
        'URL: https://github.com/o/r/issues/1#issuecomment-9',
        'Next: read the news and update the code if needed. Then mark it as seen: replace "seen=2026-09-01T00:00Z" with "seen=2026-09-28T10:15Z", or run `todo-watch --mark-seen --ref o/r#1`.',
      ],
      fixable: false,
      suggestion: 'Mark o/r#1 as seen.',
    });
  });

  test(`should print markdown`, async () => {
    // Arrange
    const cwd = project({ 'a.ts': `// TODO(o/r#2 ${SEEN})\n` });

    // Act
    const { stdout } = await runCli(['--format', 'markdown', '--compact'], cwd);

    // Assert
    expect(stdout).toBe(
      [
        '## todo-watch',
        '',
        '### `a.ts`',
        '',
        '- **warning** `resolved` [line 1](a.ts#L1): o/r#2 "Fix crash on start" was merged on 2026-09-20, not released yet.',
        '',
        '1 problem (0 errors, 1 warning) in 1 reference.',
        '',
      ].join('\n'),
    );
  });

  test(`should print only errors with --quiet`, async () => {
    // Arrange
    const cwd = project({ 'a.ts': `// TODO(o/r#2 ${SEEN})\n// TODO(o/r#3)\n` });

    // Act
    const { stdout } = await runCli(['--quiet', '--compact'], cwd);

    // Assert
    expect(stdout.split('\n')[0]).toBe(
      'a.ts:2:9  error  format  Missing seen marker for "o/r#3". Add " seen=2026-09-28T12:00Z" after the reference, or run `todo-watch --fix`.',
    );
    expect(stdout).not.toContain('resolved');
  });

  test(`should fix files`, async () => {
    // Arrange
    const cwd = project({ 'a.ts': '// TODO(o/r#3)\n// FIXME(o/r#3 seen=2026-09-01T00:00Z)\n' });

    // Act
    const { code, stderr } = await runCli(['--fix', '--expand-short-refs'], cwd);

    // Assert
    expect(code).toBe(0);
    expect(stderr).toBe('Applied 3 changes.\n');
    expect(readFileSync(join(cwd, 'a.ts'), 'utf8')).toBe(
      '// TODO(https://github.com/o/r/issues/3 seen=2026-09-28T12:00Z)\n// FIXME(https://github.com/o/r/issues/3 seen=2026-09-01T00:00Z)\n',
    );
  });

  test(`should mark activity as seen for the given reference only`, async () => {
    // Arrange
    const cwd = project({ 'a.ts': `// TODO(o/r#1 ${SEEN})\n`, 'b.md': `TODO(o/r#1 ${SEEN})\n` });

    // Act
    const { code } = await runCli(['--mark-seen', '--ref', 'o/r#1', 'a.ts'], cwd);

    // Assert
    expect(code).toBe(0);
    expect(readFileSync(join(cwd, 'a.ts'), 'utf8')).toBe('// TODO(o/r#1 seen=2026-09-28T10:15Z)\n');
    expect(readFileSync(join(cwd, 'b.md'), 'utf8')).toBe(`TODO(o/r#1 ${SEEN})\n`);
  });

  test.each([
    [['--format', 'xml'], 'Invalid value "xml" for --format. Use one of: text, json, markdown.'],
    [['--rules', 'format,foo'], 'Invalid value "foo" for --rules. Use one of: format, invalid, resolved, activity.'],
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
      'a.ts': `// TODO(o/r#3 ${SEEN})\n`,
      'node_modules/dep/index.js': `// TODO(o/r#3)\n`,
      'packages/app/node_modules/dep/index.js': `// TODO(o/r#3)\n`,
    });
    execFileSync('git', ['init', '-q'], { cwd });

    // Act
    const result = await check({ cwd, getStatuses, now: NOW });

    // Assert
    expect(result.files.map((file) => file.path)).toEqual(['a.ts']);
  });
});
