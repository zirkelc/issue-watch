/**
 * Identifies an issue or pull request on GitHub.
 */
export type RefId = {
  owner: string;
  repo: string;
  number: number;
};

/**
 * Normalized key of a reference, e.g. `vitest-dev/vitest#123`. Owner and repo are lowercased
 * because GitHub treats them case-insensitively.
 */
export type RefKey = string;

export const toRefKey = (ref: RefId): RefKey => `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}#${ref.number}`;

export const parseRefKey = (key: RefKey): RefId => {
  const [path, number] = key.split('#') as [string, string];
  const [owner, repo] = path.split('/') as [string, string];
  return { owner, repo, number: Number(number) };
};

export const formatRef = (ref: RefId): string => `${ref.owner}/${ref.repo}#${ref.number}`;

export const ReleaseStates = {
  /** A tag that contains the merge commit was found. */
  RELEASED: 'released',
  /** The repo has tags, but none of the tags after the merge contains the merge commit. */
  UNRELEASED: 'unreleased',
  /** The repo has no tags, or the merge commit is unknown. */
  UNKNOWN: 'unknown',
} as const;

export type Release =
  | {
      state: typeof ReleaseStates.RELEASED;
      tag: string;
      url: string;
      /**
       * `false` if only newer tags were checked, because the merge is older than all fetched tags.
       * Then an earlier tag may contain the merge commit as well.
       */
      exact: boolean;
    }
  | { state: typeof ReleaseStates.UNRELEASED }
  | { state: typeof ReleaseStates.UNKNOWN };

export const PullRequestStates = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  MERGED: 'MERGED',
} as const;

export type PullRequestState = (typeof PullRequestStates)[keyof typeof PullRequestStates];

export const IssueStates = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
} as const;

export type IssueState = (typeof IssueStates)[keyof typeof IssueStates];

export const IssueStateReasons = {
  COMPLETED: 'COMPLETED',
  NOT_PLANNED: 'NOT_PLANNED',
  DUPLICATE: 'DUPLICATE',
  REOPENED: 'REOPENED',
} as const;

export type IssueStateReason = (typeof IssueStateReasons)[keyof typeof IssueStateReasons];

/**
 * A pull request that closes an issue when it is merged: linked with a closing keyword or in the
 * Development sidebar.
 */
export type LinkedPullRequest = RefId & {
  title: string;
  url: string;
  state: PullRequestState;
  mergedAt: string | undefined;
  closedAt: string | undefined;
  mergeCommit: string | undefined;
  release: Release | undefined;
};

type StatusBase = RefId & {
  title: string;
  url: string;
  createdAt: string;
  closedAt: string | undefined;
};

export const RefTypes = {
  ISSUE: 'issue',
  PULL_REQUEST: 'pull-request',
} as const;

export type IssueStatus = StatusBase & {
  type: typeof RefTypes.ISSUE;
  state: IssueState;
  stateReason: IssueStateReason | undefined;
  duplicateOf: (RefId & { title: string; url: string }) | undefined;
  linkedPullRequests: Array<LinkedPullRequest>;
};

export type PullRequestStatus = StatusBase & {
  type: typeof RefTypes.PULL_REQUEST;
  state: PullRequestState;
  mergedAt: string | undefined;
  mergeCommit: string | undefined;
  release: Release | undefined;
};

export type RefStatus = IssueStatus | PullRequestStatus;

export const FailureReasons = {
  NOT_FOUND: 'not-found',
  UNAVAILABLE: 'unavailable',
} as const;

export type FailureReason = (typeof FailureReasons)[keyof typeof FailureReasons];

export type StatusResult =
  | {
      ok: true;
      status: RefStatus;
      fetchedAt: string;
    }
  | {
      ok: false;
      reason: FailureReason;
      message: string;
      fetchedAt: string;
    };
