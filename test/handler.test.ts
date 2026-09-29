import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import type { GithubClient } from '../src/github/client.js';
import type { RawIssue } from '../src/github/query.js';
import { createStatusHandler, type HandlerDeps, type StatusRequest } from '../src/service/handler.js';

const rawIssue = (number: number): RawIssue => ({
  __typename: 'Issue',
  number,
  title: `Issue ${number}`,
  url: `https://github.com/o/r/issues/${number}`,
  state: 'OPEN',
  stateReason: null,
  createdAt: '2026-01-01T00:00:00Z',
  closedAt: null,
  repository: { nameWithOwner: 'o/r' },
  duplicateOf: null,
  closedByPullRequestsReferences: { nodes: [] },
});

/**
 * Answers every aliased reference in a status query with an open issue, except number 404.
 */
const fakeClient = () => {
  const graphql = vi.fn(async (query: string) => {
    const aliases = [...query.matchAll(/(r\d+): repository\(.*?issueOrPullRequest\(number: (\d+)\)/gs)];
    return {
      data: Object.fromEntries(
        aliases.map((match) => [
          match[1],
          { issueOrPullRequest: match[2] === '404' ? null : rawIssue(Number(match[2])) },
        ]),
      ),
      errors: aliases
        .filter((match) => match[2] === '404')
        .map((match) => ({ type: 'NOT_FOUND', path: [match[1]!], message: 'x' })),
    };
  });
  return { client: { graphql, rest: vi.fn() } as unknown as GithubClient, graphql };
};

const request = (numbers: Array<number>, overrides: Partial<StatusRequest> = {}): StatusRequest => ({
  refs: numbers.map((number) => ({ owner: 'o', repo: 'r', number })),
  cwd: '/project',
  keywords: ['TODO'],
  cacheTtl: 60,
  prefetch: false,
  ...overrides,
});

const setup = (overrides: Partial<HandlerDeps> = {}) => {
  const { client, graphql } = fakeClient();
  let now = new Date('2026-09-28T10:00:00Z');
  const deps: Partial<HandlerDeps> = {
    createClient: () => client,
    resolveToken: () => 'token',
    now: () => now,
    scan: () => [],
    cacheFile: () => undefined,
    ...overrides,
  };
  const handler = createStatusHandler(deps);
  const advance = (minutes: number) => {
    now = new Date(now.getTime() + minutes * 60_000);
  };
  return { handler, graphql, advance };
};

describe('createStatusHandler', () => {
  test(`should answer from memory within the cache ttl`, async () => {
    // Arrange
    const { handler, graphql, advance } = setup();
    await handler(request([1, 2]));
    advance(59);

    // Act
    const response = await handler(request([1]));

    // Assert
    expect(graphql.mock.calls.length).toBe(1);
    expect(Object.keys(response)).toEqual(['o/r#1']);
    expect(response['o/r#1']?.ok).toBe(true);
  });

  test(`should fetch again after the cache ttl`, async () => {
    // Arrange
    const { handler, graphql, advance } = setup();
    await handler(request([1]));
    advance(61);

    // Act
    await handler(request([1]));

    // Assert
    expect(graphql.mock.calls.length).toBe(2);
  });

  test(`should cache not found results`, async () => {
    // Arrange
    const { handler, graphql } = setup();
    await handler(request([404]));

    // Act
    const response = await handler(request([404]));

    // Assert
    expect(graphql.mock.calls.length).toBe(1);
    expect(response['o/r#404']).toMatchObject({ ok: false, reason: 'not-found' });
  });

  test(`should report unavailable without token and not cache it`, async () => {
    // Arrange
    const { handler, graphql } = setup({ resolveToken: () => undefined });

    // Act
    const response = await handler(request([1]));

    // Assert
    expect(graphql.mock.calls.length).toBe(0);
    expect(response['o/r#1']).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  test(`should prefetch scanned references once`, async () => {
    // Arrange
    const scan = vi.fn(() => [
      { owner: 'o', repo: 'r', number: 2 },
      { owner: 'o', repo: 'r', number: 3 },
    ]);
    const { handler, graphql } = setup({ scan });

    // Act
    const first = await handler(request([1], { prefetch: true }));
    const second = await handler(request([2, 3], { prefetch: true }));

    // Assert
    expect(scan.mock.calls.length).toBe(1);
    expect(graphql.mock.calls.length).toBe(1);
    expect(graphql.mock.calls[0]![0].match(/issueOrPullRequest\(number/g)?.length).toBe(3);
    expect(Object.keys(first)).toEqual(['o/r#1']);
    expect(Object.keys(second)).toEqual(['o/r#2', 'o/r#3']);
  });

  test(`should persist the cache to disk and read it in a new handler`, async () => {
    // Arrange
    const file = join(mkdtempSync(join(tmpdir(), 'issue-watch-')), 'cache.json');
    const first = setup({ cacheFile: () => file });
    await first.handler(request([1]));
    const second = setup({ cacheFile: () => file });

    // Act
    const response = await second.handler(request([1]));

    // Assert
    expect(second.graphql.mock.calls.length).toBe(0);
    expect(response['o/r#1']?.ok).toBe(true);
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')).statuses)).toEqual(['o/r#1']);
  });
});
