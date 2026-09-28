import {
  RefTypes,
  type IssueStateReason,
  type IssueStatus,
  type LinkedPullRequest,
  type PullRequestState,
  type PullRequestStatus,
  type RefId,
  type RefStatus,
} from './types.js';

const LINKED_PULL_REQUESTS_LIMIT = 10;

const ISSUE_FIELDS = `
  number title url state stateReason createdAt closedAt
  repository { nameWithOwner }
  duplicateOf { number title url repository { nameWithOwner } }
  closedByPullRequestsReferences(first: ${LINKED_PULL_REQUESTS_LIMIT}, includeClosedPrs: true) {
    nodes { number title url state mergedAt closedAt mergeCommit { oid } repository { nameWithOwner } }
  }`;

const PULL_REQUEST_FIELDS = `
  number title url state createdAt closedAt mergedAt
  repository { nameWithOwner }
  mergeCommit { oid }`;

export const aliasOf = (index: number) => `r${index}`;

/**
 * Builds one GraphQL query that fetches all references at once, each under its own alias.
 */
export const buildStatusQuery = (refs: Array<RefId>): string => {
  const parts = refs.map(
    (ref, index) => `
    ${aliasOf(index)}: repository(owner: ${JSON.stringify(ref.owner)}, name: ${JSON.stringify(ref.repo)}) {
      issueOrPullRequest(number: ${ref.number}) {
        __typename
        ... on Issue { ${ISSUE_FIELDS} }
        ... on PullRequest { ${PULL_REQUEST_FIELDS} }
      }
    }`,
  );

  return `query { ${parts.join('\n')} }`;
};

type RawRepository = { nameWithOwner: string };

type RawLinkedPullRequest = {
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  mergedAt: string | null;
  closedAt: string | null;
  mergeCommit: { oid: string } | null;
  repository: RawRepository;
};

export type RawIssue = {
  __typename: 'Issue';
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED';
  stateReason: IssueStateReason | null;
  createdAt: string;
  closedAt: string | null;
  repository: RawRepository;
  duplicateOf: { number: number; title: string; url: string; repository: RawRepository } | null;
  closedByPullRequestsReferences: { nodes: Array<RawLinkedPullRequest> };
};

export type RawPullRequest = {
  __typename: 'PullRequest';
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  createdAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  repository: RawRepository;
  mergeCommit: { oid: string } | null;
};

export type RawStatusData = Record<string, { issueOrPullRequest: RawIssue | RawPullRequest | null } | null>;

const splitNameWithOwner = (nameWithOwner: string) => {
  const [owner, repo] = nameWithOwner.split('/') as [string, string];
  return { owner, repo };
};

const normalizeIssue = (raw: RawIssue): IssueStatus => ({
  type: RefTypes.ISSUE,
  ...splitNameWithOwner(raw.repository.nameWithOwner),
  number: raw.number,
  title: raw.title,
  url: raw.url,
  state: raw.state,
  stateReason: raw.stateReason ?? undefined,
  createdAt: raw.createdAt,
  closedAt: raw.closedAt ?? undefined,
  duplicateOf: raw.duplicateOf
    ? {
        ...splitNameWithOwner(raw.duplicateOf.repository.nameWithOwner),
        number: raw.duplicateOf.number,
        title: raw.duplicateOf.title,
        url: raw.duplicateOf.url,
      }
    : undefined,
  linkedPullRequests: raw.closedByPullRequestsReferences.nodes.map(
    (node): LinkedPullRequest => ({
      ...splitNameWithOwner(node.repository.nameWithOwner),
      number: node.number,
      title: node.title,
      url: node.url,
      state: node.state,
      mergedAt: node.mergedAt ?? undefined,
      closedAt: node.closedAt ?? undefined,
      mergeCommit: node.mergeCommit?.oid,
      release: undefined,
    }),
  ),
});

const normalizePullRequest = (raw: RawPullRequest): PullRequestStatus => ({
  type: RefTypes.PULL_REQUEST,
  ...splitNameWithOwner(raw.repository.nameWithOwner),
  number: raw.number,
  title: raw.title,
  url: raw.url,
  state: raw.state,
  createdAt: raw.createdAt,
  closedAt: raw.closedAt ?? undefined,
  mergedAt: raw.mergedAt ?? undefined,
  mergeCommit: raw.mergeCommit?.oid,
  release: undefined,
});

export const normalizeStatus = (raw: RawIssue | RawPullRequest): RefStatus =>
  raw.__typename === 'Issue' ? normalizeIssue(raw) : normalizePullRequest(raw);
