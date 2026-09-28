import {
  EventTypes,
  RefTypes,
  type Author,
  type Comment,
  type IssueStateReason,
  type IssueStatus,
  type LinkedPullRequest,
  type PullRequestState,
  type PullRequestStatus,
  type RefId,
  type RefStatus,
  type TimelineEvent,
} from './types.js';

const COMMENTS_LIMIT = 50;
const TIMELINE_LIMIT = 100;
const REVIEWS_LIMIT = 30;
const LINKED_PULL_REQUESTS_LIMIT = 10;

const AUTHOR = `author { __typename login }`;
const COMMENTS = `comments(last: ${COMMENTS_LIMIT}) { nodes { url createdAt bodyText ${AUTHOR} } }`;

const ISSUE_FIELDS = `
  number title url state stateReason createdAt closedAt
  repository { nameWithOwner }
  duplicateOf { number title url repository { nameWithOwner } }
  ${COMMENTS}
  timelineItems(last: ${TIMELINE_LIMIT}, itemTypes: [REOPENED_EVENT, CLOSED_EVENT, CROSS_REFERENCED_EVENT, CONNECTED_EVENT, LABELED_EVENT, MILESTONED_EVENT]) {
    nodes {
      __typename
      ... on ReopenedEvent { createdAt }
      ... on ClosedEvent { createdAt }
      ... on LabeledEvent { createdAt label { name } }
      ... on MilestonedEvent { createdAt milestoneTitle }
      ... on CrossReferencedEvent { createdAt willCloseTarget source { ... on PullRequest { url } } }
      ... on ConnectedEvent { createdAt subject { ... on PullRequest { url } } }
    }
  }
  closedByPullRequestsReferences(first: ${LINKED_PULL_REQUESTS_LIMIT}, includeClosedPrs: true) {
    nodes { number title url state createdAt mergedAt closedAt mergeCommit { oid } repository { nameWithOwner } }
  }`;

const PULL_REQUEST_FIELDS = `
  number title url state createdAt closedAt mergedAt isDraft
  repository { nameWithOwner }
  mergeCommit { oid }
  ${COMMENTS}
  reviews(last: ${REVIEWS_LIMIT}) { nodes { state url createdAt ${AUTHOR} } }
  timelineItems(last: ${TIMELINE_LIMIT}, itemTypes: [REOPENED_EVENT, CLOSED_EVENT, READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT, LABELED_EVENT, MILESTONED_EVENT]) {
    nodes {
      __typename
      ... on ReopenedEvent { createdAt }
      ... on ClosedEvent { createdAt }
      ... on ReadyForReviewEvent { createdAt }
      ... on ConvertToDraftEvent { createdAt }
      ... on LabeledEvent { createdAt label { name } }
      ... on MilestonedEvent { createdAt milestoneTitle }
    }
  }`;

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

  return `query { viewer { login } ${parts.join('\n')} }`;
};

type RawAuthor = { __typename: string; login: string } | null;
type RawComment = { url: string; createdAt: string; bodyText: string; author: RawAuthor };
type RawRepository = { nameWithOwner: string };

type RawTimelineItem = {
  __typename: string;
  createdAt?: string;
  label?: { name: string };
  milestoneTitle?: string;
  willCloseTarget?: boolean;
  source?: { url?: string };
  subject?: { url?: string };
};

type RawLinkedPullRequest = {
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  createdAt: string;
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
  comments: { nodes: Array<RawComment> };
  timelineItems: { nodes: Array<RawTimelineItem> };
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
  isDraft: boolean;
  repository: RawRepository;
  mergeCommit: { oid: string } | null;
  comments: { nodes: Array<RawComment> };
  reviews: { nodes: Array<{ state: string; url: string; createdAt: string; author: RawAuthor }> };
  timelineItems: { nodes: Array<RawTimelineItem> };
};

export type RawStatusData = {
  viewer?: { login: string };
} & Record<string, { issueOrPullRequest: RawIssue | RawPullRequest | null } | null | { login: string }>;

const splitNameWithOwner = (nameWithOwner: string) => {
  const [owner, repo] = nameWithOwner.split('/') as [string, string];
  return { owner, repo };
};

const toAuthor = (raw: RawAuthor): Author | undefined =>
  raw ? { login: raw.login, isBot: raw.__typename === 'Bot' || raw.login.endsWith('[bot]') } : undefined;

const toComments = (nodes: Array<RawComment>): Array<Comment> =>
  nodes.map((node) => ({
    url: node.url,
    createdAt: node.createdAt,
    body: node.bodyText,
    author: toAuthor(node.author),
  }));

const EVENT_TYPES: Record<string, TimelineEvent['type']> = {
  ReopenedEvent: EventTypes.REOPENED,
  ClosedEvent: EventTypes.CLOSED,
  ReadyForReviewEvent: EventTypes.READY_FOR_REVIEW,
  ConvertToDraftEvent: EventTypes.CONVERTED_TO_DRAFT,
  LabeledEvent: EventTypes.LABELED,
  MilestonedEvent: EventTypes.MILESTONED,
};

const toEvents = (nodes: Array<RawTimelineItem>): Array<TimelineEvent> =>
  nodes.flatMap((node) => {
    const type = EVENT_TYPES[node.__typename];
    if (!type || !node.createdAt) return [];

    const detail = node.label?.name ?? node.milestoneTitle;
    return [{ type, createdAt: node.createdAt, ...(detail ? { detail } : {}) }];
  });

/**
 * Finds when each pull request was linked to the issue, from the earliest closing cross reference
 * or manual connection in the timeline.
 */
const toLinkedAt = (nodes: Array<RawTimelineItem>): Map<string, string> => {
  const linkedAt = new Map<string, string>();

  for (const node of nodes) {
    const url =
      node.__typename === 'CrossReferencedEvent' && node.willCloseTarget
        ? node.source?.url
        : node.__typename === 'ConnectedEvent'
          ? node.subject?.url
          : undefined;
    if (!url || !node.createdAt) continue;

    const previous = linkedAt.get(url);
    if (!previous || node.createdAt < previous) linkedAt.set(url, node.createdAt);
  }

  return linkedAt;
};

const normalizeIssue = (raw: RawIssue): IssueStatus => {
  const linkedAt = toLinkedAt(raw.timelineItems.nodes);

  const linkedPullRequests = raw.closedByPullRequestsReferences.nodes.map(
    (node): LinkedPullRequest => ({
      ...splitNameWithOwner(node.repository.nameWithOwner),
      number: node.number,
      title: node.title,
      url: node.url,
      state: node.state,
      linkedAt: linkedAt.get(node.url) ?? node.createdAt,
      mergedAt: node.mergedAt ?? undefined,
      closedAt: node.closedAt ?? undefined,
      mergeCommit: node.mergeCommit?.oid,
      release: undefined,
    }),
  );

  return {
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
    comments: toComments(raw.comments.nodes),
    events: toEvents(raw.timelineItems.nodes),
    linkedPullRequests,
  };
};

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
  isDraft: raw.isDraft,
  mergeCommit: raw.mergeCommit?.oid,
  release: undefined,
  comments: toComments(raw.comments.nodes),
  reviews: raw.reviews.nodes.map((node) => ({
    state: node.state,
    url: node.url,
    createdAt: node.createdAt,
    author: toAuthor(node.author),
  })),
  events: toEvents(raw.timelineItems.nodes),
});

export const normalizeStatus = (raw: RawIssue | RawPullRequest): RefStatus =>
  raw.__typename === 'Issue' ? normalizeIssue(raw) : normalizePullRequest(raw);
