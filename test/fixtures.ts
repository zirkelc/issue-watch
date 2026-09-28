import type { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';
import {
  RefTypes,
  toRefKey,
  type IssueStatus,
  type LinkedPullRequest,
  type PullRequestStatus,
  type StatusResult,
} from '../src/github/types.js';
import type { StatusProvider } from '../src/plugin/provider.js';

export const FETCHED_AT = '2026-09-28T10:15:42.000Z';

export const setupRuleTester = (tester: typeof RuleTester) => {
  tester.describe = describe;
  tester.it = it;
};

export const issue = (overrides: Partial<IssueStatus> = {}): IssueStatus => ({
  type: RefTypes.ISSUE,
  owner: 'o',
  repo: 'r',
  number: 1,
  title: 'Crash on start',
  url: `https://github.com/o/r/issues/${overrides.number ?? 1}`,
  state: 'OPEN',
  stateReason: undefined,
  createdAt: '2026-01-01T00:00:00Z',
  closedAt: undefined,
  duplicateOf: undefined,
  comments: [],
  events: [],
  linkedPullRequests: [],
  ...overrides,
});

export const pullRequest = (overrides: Partial<PullRequestStatus> = {}): PullRequestStatus => ({
  type: RefTypes.PULL_REQUEST,
  owner: 'o',
  repo: 'r',
  number: 2,
  title: 'Fix crash on start',
  url: `https://github.com/o/r/pull/${overrides.number ?? 2}`,
  state: 'OPEN',
  createdAt: '2026-01-01T00:00:00Z',
  closedAt: undefined,
  mergedAt: undefined,
  isDraft: false,
  mergeCommit: undefined,
  release: undefined,
  comments: [],
  reviews: [],
  events: [],
  ...overrides,
});

export const linkedPullRequest = (overrides: Partial<LinkedPullRequest> = {}): LinkedPullRequest => ({
  owner: 'o',
  repo: 'r',
  number: 5,
  title: 'Fix the crash',
  url: `https://github.com/o/r/pull/${overrides.number ?? 5}`,
  state: 'OPEN',
  linkedAt: '2026-01-01T00:00:00Z',
  mergedAt: undefined,
  closedAt: undefined,
  mergeCommit: undefined,
  release: undefined,
  ...overrides,
});

export const ok = (status: IssueStatus | PullRequestStatus, viewer = 'me'): StatusResult => ({
  ok: true,
  status,
  viewer,
  fetchedAt: FETCHED_AT,
});

/**
 * A provider that answers from a fixed map of results, keyed by `owner/repo#number`.
 */
export const fakeProvider =
  (results: Record<string, StatusResult>): StatusProvider =>
  (request) =>
    Object.fromEntries(
      request.refs.flatMap((ref) => (results[toRefKey(ref)] ? [[toRefKey(ref), results[toRefKey(ref)]!]] : [])),
    );
