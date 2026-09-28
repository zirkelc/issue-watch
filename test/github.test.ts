import { describe, expect, test, vi } from 'vitest';
import type { GithubClient } from '../src/github/client.js';
import { fetchStatuses, type CachedRelease } from '../src/github/fetch-statuses.js';
import type { RawIssue, RawPullRequest } from '../src/github/query.js';
import { findRelease, type Tag } from '../src/github/release.js';

const NOW = new Date('2026-09-28T10:00:00Z');

const rawIssue = (overrides: Partial<RawIssue> = {}): RawIssue => ({
  __typename: 'Issue',
  number: 1,
  title: 'Crash on start',
  url: 'https://github.com/o/r/issues/1',
  state: 'OPEN',
  stateReason: null,
  createdAt: '2026-01-01T00:00:00Z',
  closedAt: null,
  repository: { nameWithOwner: 'o/r' },
  duplicateOf: null,
  closedByPullRequestsReferences: { nodes: [] },
  ...overrides,
});

const rawPullRequest = (overrides: Partial<RawPullRequest> = {}): RawPullRequest => ({
  __typename: 'PullRequest',
  number: 2,
  title: 'Fix crash on start',
  url: 'https://github.com/o/r/pull/2',
  state: 'OPEN',
  createdAt: '2026-01-01T00:00:00Z',
  closedAt: null,
  mergedAt: null,
  repository: { nameWithOwner: 'o/r' },
  mergeCommit: null,
  ...overrides,
});

type FakeClientOptions = {
  statuses?: (query: string) => unknown;
  tags?: Array<{ name: string; oid: string; committedDate: string }>;
  contains?: (commit: string, tagOid: string) => boolean;
  issuesRest?: (path: string) => { status: number; data: unknown };
};

const fakeClient = (options: FakeClientOptions) => {
  const graphql = vi.fn(async (query: string) => {
    if (query.includes('refPrefix')) {
      return {
        data: {
          repository: {
            refs: {
              nodes: (options.tags ?? []).map((tag) => ({
                name: tag.name,
                target: { __typename: 'Commit', oid: tag.oid, committedDate: tag.committedDate },
              })),
            },
          },
        },
      };
    }
    return options.statuses!(query);
  });

  const rest = vi.fn(async (path: string) => {
    const compare = /\/compare\/(\w+)\.\.\.(\w+)$/.exec(path);
    if (compare) {
      return { status: 200, data: { status: options.contains?.(compare[1]!, compare[2]!) ? 'ahead' : 'diverged' } };
    }
    return options.issuesRest?.(path) ?? { status: 404, data: {} };
  });

  return { client: { graphql, rest } as unknown as GithubClient, graphql, rest };
};

const fetchOptions = (releaseCache = new Map<string, CachedRelease>()) => ({
  now: () => NOW,
  releaseCache,
  releaseTtlMs: 60 * 60_000,
});

describe('fetchStatuses', () => {
  test(`should normalize an issue with linked pull requests`, async () => {
    // Arrange
    const { client, graphql } = fakeClient({
      statuses: () => ({
        data: {
          r0: {
            issueOrPullRequest: rawIssue({
              closedByPullRequestsReferences: {
                nodes: [
                  {
                    number: 5,
                    title: 'Fix the crash',
                    url: 'https://github.com/o/r/pull/5',
                    state: 'OPEN',
                    mergedAt: null,
                    closedAt: null,
                    mergeCommit: null,
                    repository: { nameWithOwner: 'o/r' },
                  },
                ],
              },
            }),
          },
        },
      }),
    });

    // Act
    const results = await fetchStatuses(client, [{ owner: 'O', repo: 'R', number: 1 }], fetchOptions());

    // Assert
    expect(graphql.mock.calls.length).toBe(1);
    const result = results.get('o/r#1');
    expect(result?.ok).toBe(true);
    if (!result?.ok || result.status.type !== 'issue') throw new Error('unexpected result');
    expect(result.fetchedAt).toBe(NOW.toISOString());
    expect(result.status.title).toBe('Crash on start');
    expect(result.status.linkedPullRequests).toEqual([
      {
        owner: 'o',
        repo: 'r',
        number: 5,
        title: 'Fix the crash',
        url: 'https://github.com/o/r/pull/5',
        state: 'OPEN',
        mergedAt: undefined,
        closedAt: undefined,
        mergeCommit: undefined,
        release: undefined,
      },
    ]);
  });

  test(`should batch many references into few queries`, async () => {
    // Arrange
    const refs = Array.from({ length: 45 }, (_, index) => ({ owner: 'o', repo: 'r', number: index + 1 }));
    const { client, graphql } = fakeClient({
      statuses: (query) => {
        const aliases = [...query.matchAll(/(r\d+): repository\(.*?issueOrPullRequest\(number: (\d+)\)/gs)];
        return {
          data: Object.fromEntries(
            aliases.map((match) => [
              match[1],
              {
                issueOrPullRequest: rawIssue({
                  number: Number(match[2]),
                  url: `https://github.com/o/r/issues/${match[2]}`,
                }),
              },
            ]),
          ),
        };
      },
    });

    // Act
    const results = await fetchStatuses(client, [...refs, refs[0]!], fetchOptions());

    // Assert
    expect(graphql.mock.calls.length).toBe(3);
    expect(results.size).toBe(45);
    const last = results.get('o/r#45');
    expect(last?.ok && last.status.number).toBe(45);
  });

  test(`should report not found and unavailable results`, async () => {
    // Arrange
    const { client } = fakeClient({
      statuses: () => ({
        data: { r0: { issueOrPullRequest: null }, r1: null, r2: { issueOrPullRequest: null } },
        errors: [
          { type: 'NOT_FOUND', path: ['r0', 'issueOrPullRequest'], message: 'Could not resolve' },
          { type: 'NOT_FOUND', path: ['r1'], message: 'Could not resolve to a Repository' },
          { type: 'FORBIDDEN', path: ['r2'], message: 'Resource not accessible' },
        ],
      }),
    });

    // Act
    const results = await fetchStatuses(
      client,
      [
        { owner: 'o', repo: 'r', number: 404 },
        { owner: 'gone', repo: 'repo', number: 1 },
        { owner: 'secret', repo: 'repo', number: 1 },
      ],
      fetchOptions(),
    );

    // Assert
    expect(results.get('o/r#404')).toMatchObject({ ok: false, reason: 'not-found' });
    expect(results.get('gone/repo#1')).toMatchObject({ ok: false, reason: 'not-found' });
    expect(results.get('secret/repo#1')).toMatchObject({
      ok: false,
      reason: 'unavailable',
      message: 'Resource not accessible',
    });
  });

  test(`should mark all references unavailable if the request fails`, async () => {
    // Arrange
    const { client } = fakeClient({
      statuses: () => {
        throw new Error('network down');
      },
    });

    // Act
    const results = await fetchStatuses(client, [{ owner: 'o', repo: 'r', number: 1 }], fetchOptions());

    // Assert
    expect(results.get('o/r#1')).toEqual({
      ok: false,
      reason: 'unavailable',
      message: 'network down',
      fetchedAt: NOW.toISOString(),
    });
  });

  test(`should follow transferred issues`, async () => {
    // Arrange
    const { client, rest } = fakeClient({
      statuses: (query) =>
        query.includes('"old"')
          ? {
              data: { r0: { issueOrPullRequest: null } },
              errors: [{ type: 'NOT_FOUND', path: ['r0', 'issueOrPullRequest'], message: 'x' }],
            }
          : {
              data: {
                r0: {
                  issueOrPullRequest: rawIssue({
                    number: 9,
                    url: 'https://github.com/new/repo/issues/9',
                    repository: { nameWithOwner: 'new/repo' },
                  }),
                },
              },
            },
      issuesRest: () => ({ status: 200, data: { html_url: 'https://github.com/new/repo/issues/9' } }),
    });

    // Act
    const results = await fetchStatuses(client, [{ owner: 'old', repo: 'repo', number: 1 }], fetchOptions());

    // Assert
    expect(rest.mock.calls[0]).toEqual(['/repos/old/repo/issues/1']);
    const result = results.get('old/repo#1');
    expect(result?.ok && [result.status.owner, result.status.repo, result.status.number]).toEqual(['new', 'repo', 9]);
  });

  test(`should add the release of a merged pull request`, async () => {
    // Arrange
    const releaseCache = new Map<string, CachedRelease>();
    const { client } = fakeClient({
      statuses: () => ({
        data: {
          r0: {
            issueOrPullRequest: rawPullRequest({
              state: 'MERGED',
              mergedAt: '2026-05-01T00:00:00Z',
              mergeCommit: { oid: 'abc' },
            }),
          },
        },
      }),
      tags: [
        { name: 'v2.0.0', oid: 't3', committedDate: '2026-06-01T00:00:00Z' },
        { name: 'v1.1.0', oid: 't2', committedDate: '2026-05-02T00:00:00Z' },
        { name: 'v1.0.0', oid: 't1', committedDate: '2026-04-01T00:00:00Z' },
      ],
      contains: (commit, tag) => commit === 'abc' && tag === 't3',
    });

    // Act
    const results = await fetchStatuses(client, [{ owner: 'o', repo: 'r', number: 2 }], fetchOptions(releaseCache));

    // Assert
    const result = results.get('o/r#2');
    expect(result?.ok && result.status.type === 'pull-request' && result.status.release).toEqual({
      state: 'released',
      tag: 'v2.0.0',
      url: 'https://github.com/o/r/releases/tag/v2.0.0',
      exact: true,
    });
    expect(releaseCache.get('o/r@abc')?.release.state).toBe('released');
  });

  test(`should reuse a cached release without requests`, async () => {
    // Arrange
    const releaseCache = new Map<string, CachedRelease>([
      [
        'o/r@abc',
        {
          release: { state: 'released', tag: 'v1', url: 'https://github.com/o/r/releases/tag/v1', exact: true },
          fetchedAt: '2020-01-01T00:00:00Z',
        },
      ],
    ]);
    const { client, rest, graphql } = fakeClient({
      statuses: () => ({
        data: {
          r0: {
            issueOrPullRequest: rawPullRequest({
              state: 'MERGED',
              mergedAt: '2026-05-01T00:00:00Z',
              mergeCommit: { oid: 'abc' },
            }),
          },
        },
      }),
    });

    // Act
    await fetchStatuses(client, [{ owner: 'o', repo: 'r', number: 2 }], fetchOptions(releaseCache));

    // Assert
    expect(graphql.mock.calls.length).toBe(1);
    expect(rest.mock.calls.length).toBe(0);
  });
});

describe('findRelease', () => {
  const tag = (name: string, committedDate: string): Tag => ({ name, oid: name, committedDate });

  test(`should be unknown without tags`, async () => {
    // Arrange
    const { client } = fakeClient({});

    // Act
    const release = await findRelease(client, 'o', 'r', 'abc', '2026-05-01T00:00:00Z', []);

    // Assert
    expect(release).toEqual({ state: 'unknown' });
  });

  test(`should be unreleased if no tag after the merge contains the commit`, async () => {
    // Arrange
    const { client, rest } = fakeClient({ contains: () => false });
    const tags = [tag('v1', '2026-04-01T00:00:00Z'), tag('v2', '2026-05-02T00:00:00Z')];

    // Act
    const release = await findRelease(client, 'o', 'r', 'abc', '2026-05-01T00:00:00Z', tags);

    // Assert
    expect(release).toEqual({ state: 'unreleased' });
    expect(rest.mock.calls).toEqual([['/repos/o/r/compare/abc...v2']]);
  });

  test(`should pick the oldest tag that contains the commit`, async () => {
    // Arrange
    const { client } = fakeClient({ contains: (_, tagOid) => tagOid !== 'v2' });
    const tags = [
      tag('v4', '2026-08-01T00:00:00Z'),
      tag('v3', '2026-07-01T00:00:00Z'),
      tag('v2', '2026-06-01T00:00:00Z'),
    ];

    // Act
    const release = await findRelease(client, 'o', 'r', 'abc', '2026-05-01T00:00:00Z', tags);

    // Assert
    expect(release).toEqual({
      state: 'released',
      tag: 'v3',
      url: 'https://github.com/o/r/releases/tag/v3',
      exact: true,
    });
  });
});

describe('findRelease with a limited tag window', () => {
  test(`should not be exact if all fetched tags are newer than the merge`, async () => {
    // Arrange
    const { client } = fakeClient({ contains: () => true });
    const tags = Array.from({ length: 50 }, (_, index) => ({
      name: `v${index}`,
      oid: `t${index}`,
      committedDate: `2026-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    }));

    // Act
    const release = await findRelease(client, 'o', 'r', 'abc', '2016-01-01T00:00:00Z', tags);

    // Assert
    expect(release).toMatchObject({ state: 'released', exact: false });
  });
});
