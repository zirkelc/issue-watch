import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { formatShortRef, parseTodos, parseWatch } from '../src/parse.js';
import { createHistoryLookup } from '../src/service/history.js';
import { detectRepository, parseRepository } from '../src/service/repo.js';

const REPOSITORY = { owner: 'vitest-dev', repo: 'vitest' };

const gitRepo = () => {
  const cwd = mkdtempSync(join(tmpdir(), 'todo-watch-git-'));
  const git = (args: Array<string>, date?: string) =>
    execFileSync('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
      },
      encoding: 'utf8',
    });
  git(['init', '-q']);
  return { cwd, git };
};

describe('parseTodos with local references', () => {
  test(`should resolve #123 against the repository`, () => {
    // Act
    const [todo] = parseTodos('TODO(#123 seen=2026-09-28T10:03Z)', ['TODO'], REPOSITORY);

    // Assert
    expect(todo?.entries[0]?.ref).toMatchObject({ kind: 'local', owner: 'vitest-dev', repo: 'vitest', number: 123 });
    expect(todo?.entries[0]?.unresolved).toBe(undefined);
  });

  test(`should keep #123 unresolved without a repository`, () => {
    // Act
    const [todo] = parseTodos('TODO(#123)');

    // Assert
    expect(todo?.entries[0]?.ref).toBe(undefined);
    expect(todo?.entries[0]?.unresolved?.text).toBe('#123');
  });

  test(`should split entries only before references`, () => {
    // Act
    const [todo] = parseTodos('TODO(o/r#1 watch=comments,links, #2,o/r#3)', ['TODO'], REPOSITORY);

    // Assert
    expect(todo?.entries.map((entry) => entry.ref?.number)).toEqual([1, 2, 3]);
    expect(todo?.entries[0]?.watch?.categories).toEqual(['comments', 'links']);
  });
});

describe('parseWatch', () => {
  test.each([
    ['comments', ['comments']],
    ['links,comments,links', ['links', 'comments']],
    ['none', []],
    ['comments,', undefined],
    ['comment', undefined],
  ])(`should parse %s`, (value, expected) => {
    // Act
    const categories = parseWatch(value);

    // Assert
    expect(categories).toEqual(expected);
  });
});

describe('formatShortRef', () => {
  test(`should use #123 in the repository of the project`, () => {
    // Act
    const local = formatShortRef({ owner: 'Vitest-Dev', repo: 'vitest', number: 1 }, REPOSITORY);
    const other = formatShortRef({ owner: 'o', repo: 'r', number: 1 }, REPOSITORY);

    // Assert
    expect(local).toBe('#1');
    expect(other).toBe('o/r#1');
  });
});

describe('parseRepository', () => {
  test.each([
    'https://github.com/vitest-dev/vitest.git',
    'https://github.com/vitest-dev/vitest',
    'git@github.com:vitest-dev/vitest.git',
    'ssh://git@github.com/vitest-dev/vitest.git',
    'git+https://github.com/vitest-dev/vitest.git',
    'github:vitest-dev/vitest',
    'vitest-dev/vitest',
  ])(`should parse %s`, (value) => {
    // Act
    const repository = parseRepository(value);

    // Assert
    expect(repository).toEqual(REPOSITORY);
  });

  test(`should reject other hosts`, () => {
    // Act
    const repository = parseRepository('https://gitlab.com/o/r.git');

    // Assert
    expect(repository).toBe(undefined);
  });
});

describe('detectRepository', () => {
  test(`should prefer upstream over origin`, () => {
    // Arrange
    const { cwd, git } = gitRepo();
    git(['remote', 'add', 'origin', 'git@github.com:me/vitest.git']);
    git(['remote', 'add', 'upstream', 'https://github.com/vitest-dev/vitest.git']);

    // Act
    const repository = detectRepository(cwd);

    // Assert
    expect(repository).toEqual(REPOSITORY);
  });

  test(`should fall back to package.json`, () => {
    // Arrange
    const cwd = mkdtempSync(join(tmpdir(), 'todo-watch-pkg-'));
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ repository: { url: 'git+https://github.com/o/r.git' } }));

    // Act
    const repository = detectRepository(cwd);

    // Assert
    expect(repository).toEqual({ owner: 'o', repo: 'r' });
  });
});

describe('createHistoryLookup', () => {
  test(`should find the commit that added the reference, not the last change of the line`, () => {
    // Arrange
    const { cwd, git } = gitRepo();
    const file = join(cwd, 'a.ts');
    writeFileSync(file, 'export const a = 1;\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'init'], '2024-01-01T00:00:00Z');
    writeFileSync(file, '// TODO(o/r#1): workaround\nexport const a = 1;\n');
    git(['commit', '-q', '-am', 'add todo'], '2025-03-04T05:06:00Z');
    writeFileSync(file, '// TODO(o/r#1): workaround for the crash\nexport const a = 1;\n');
    git(['commit', '-q', '-am', 'edit todo'], '2026-01-01T00:00:00Z');
    const lookup = createHistoryLookup();

    // Act
    const addedAt = lookup(file, 'o/r#1', 1);

    // Assert
    expect(addedAt?.toISOString()).toBe('2025-03-04T05:06:00.000Z');
  });

  test(`should use blame if the reference text changed`, () => {
    // Arrange
    const { cwd, git } = gitRepo();
    const file = join(cwd, 'a.ts');
    writeFileSync(file, '// TODO(https://github.com/o/r/issues/1)\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'add'], '2025-06-07T08:09:00Z');
    const lookup = createHistoryLookup();

    // Act
    const addedAt = lookup(file, 'o/r#1', 1);

    // Assert
    expect(addedAt?.toISOString()).toBe('2025-06-07T08:09:00.000Z');
  });

  test(`should return nothing for code that is not committed`, () => {
    // Arrange
    const { cwd } = gitRepo();
    const file = join(cwd, 'a.ts');
    writeFileSync(file, '// TODO(o/r#1)\n');
    const lookup = createHistoryLookup();

    // Act
    const addedAt = lookup(file, 'o/r#1', 1);

    // Assert
    expect(addedAt).toBe(undefined);
  });
});
