import { describe, expect, test } from 'vitest';
import { parseRef, parseTodos, toRefUrl } from '../src/parse.js';

const token = (text: string) => ({ text, start: 0, end: text.length });

describe('parseRef', () => {
  test.each([
    ['https://github.com/o/r/issues/123', 'o', 'r', 123],
    ['https://github.com/o/r/pull/45', 'o', 'r', 45],
    ['https://github.com/o/r/pull/45/files', 'o', 'r', 45],
    ['https://github.com/o/r/issues/123#issuecomment-99', 'o', 'r', 123],
    ['https://github.com/o/r/pull/45#discussion_r123', 'o', 'r', 45],
    ['https://github.com/o/r/issues/123?notification_referrer_id=1', 'o', 'r', 123],
    ['https://www.github.com/my-org/my.repo_x/issues/7', 'my-org', 'my.repo_x', 7],
  ])(`should parse url %s`, (text, owner, repo, number) => {
    // Act
    const ref = parseRef(token(text));

    // Assert
    expect(ref).toEqual({ ...token(text), kind: 'url', owner, repo, number });
  });

  test(`should parse short ref`, () => {
    // Act
    const ref = parseRef(token('vitest-dev/vitest#123'));

    // Assert
    expect(ref).toEqual({
      ...token('vitest-dev/vitest#123'),
      kind: 'short',
      owner: 'vitest-dev',
      repo: 'vitest',
      number: 123,
    });
  });

  test.each([
    'https://github.com/o/r/issue/1',
    'https://github.com/o/r/discussions/1',
    'https://github.com/o/r/issues/abc',
    'https://gitlab.com/o/r/issues/1',
    'o/r',
    '#123',
    'username',
  ])(`should reject %s`, (text) => {
    // Act
    const ref = parseRef(token(text));

    // Assert
    expect(ref).toBe(undefined);
  });
});

describe('toRefUrl', () => {
  test(`should build issue url`, () => {
    // Act
    const url = toRefUrl({ owner: 'o', repo: 'r', number: 1 });

    // Assert
    expect(url).toBe('https://github.com/o/r/issues/1');
  });
});

describe('parseTodos', () => {
  test(`should parse ref with offsets`, () => {
    // Arrange
    const text = ' TODO(o/r#1): use the new option';

    // Act
    const todos = parseTodos(text);

    // Assert
    expect(todos.length).toBe(1);
    const [entry] = todos[0]!.entries;
    expect(text.slice(entry!.ref!.start, entry!.ref!.end)).toBe('o/r#1');
    expect(entry!.unknown).toEqual([]);
  });

  test(`should parse multiple entries`, () => {
    // Arrange
    const text = 'FIXME(o/r#1,  https://github.com/o/r/pull/2 )';

    // Act
    const todos = parseTodos(text);

    // Assert
    const entries = todos[0]!.entries;
    expect(entries.length).toBe(2);
    expect(entries[0]!.ref!.number).toBe(1);
    expect(entries[1]!.ref!.number).toBe(2);
    expect(entries[1]!.text).toBe('https://github.com/o/r/pull/2');
    expect(text.slice(entries[1]!.start, entries[1]!.end)).toBe('https://github.com/o/r/pull/2');
  });

  test(`should collect unknown tokens`, () => {
    // Act
    const todos = parseTodos('TODO(o/r#1 please)');

    // Assert
    expect(todos[0]!.entries[0]!.unknown.map((unknown) => unknown.text)).toEqual(['please']);
  });

  test(`should keep entries without ref`, () => {
    // Act
    const todos = parseTodos('TODO(zirkelc)');

    // Assert
    expect(todos[0]!.entries[0]!.ref).toBe(undefined);
  });

  test(`should use custom keywords`, () => {
    // Act
    const todos = parseTodos('TODO(o/r#1) HACK(o/r#2)', ['HACK']);

    // Assert
    expect(todos.map((todo) => todo.keyword)).toEqual(['HACK']);
  });

  test.each(['TODO(o/r#1', 'todo(o/r#1)', 'MYTODO(o/r#1)', 'TODO: o/r#1'])(`should ignore %s`, (text) => {
    // Act
    const todos = parseTodos(text);

    // Assert
    expect(todos.length).toBe(0);
  });
});
