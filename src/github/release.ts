import type { GithubClient } from './client.js';
import { ReleaseStates, type Release } from './types.js';

const TAGS_LIMIT = 50;
const MAX_COMPARES = 5;

export type Tag = {
  name: string;
  oid: string;
  committedDate: string;
};

type RawTagTarget = {
  __typename: string;
  oid: string;
  committedDate?: string;
  target?: { oid: string; committedDate?: string };
};

type RawTags = {
  repository: {
    refs: { nodes: Array<{ name: string; target: RawTagTarget }> };
  } | null;
};

/**
 * Loads the newest tags of a repo with the commit they point to. Annotated tags are resolved to
 * their commit.
 */
export const fetchTags = async (client: GithubClient, owner: string, repo: string): Promise<Array<Tag>> => {
  const query = `query {
    repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) {
      refs(refPrefix: "refs/tags/", first: ${TAGS_LIMIT}, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
        nodes {
          name
          target {
            __typename oid
            ... on Commit { committedDate }
            ... on Tag { target { oid ... on Commit { committedDate } } }
          }
        }
      }
    }
  }`;

  const response = await client.graphql<RawTags>(query);
  const nodes = response.data?.repository?.refs.nodes ?? [];

  return nodes.flatMap((node) => {
    const commit = node.target.__typename === 'Tag' ? node.target.target : node.target;
    if (!commit?.committedDate) return [];
    return [{ name: node.name, oid: commit.oid, committedDate: commit.committedDate }];
  });
};

/**
 * Checks if a tag contains a commit. The compare API reports `ahead` or `identical` if the head
 * (the tag) contains the base (the commit).
 */
export const tagContains = async (
  client: GithubClient,
  owner: string,
  repo: string,
  commit: string,
  tag: Tag,
): Promise<boolean> => {
  const response = await client.rest<{ status?: string }>(`/repos/${owner}/${repo}/compare/${commit}...${tag.oid}`);
  return response.data.status === 'ahead' || response.data.status === 'identical';
};

/**
 * Finds the first tag that contains a merge commit. Only tags with a commit date after the merge
 * can contain it, and they are checked from oldest to newest.
 */
export const findRelease = async (
  client: GithubClient,
  owner: string,
  repo: string,
  commit: string,
  mergedAt: string,
  tags: Array<Tag>,
): Promise<Release> => {
  if (tags.length === 0) return { state: ReleaseStates.UNKNOWN };

  /** The fetched tags reach back to the merge, or there are no older tags to fetch. */
  const exact = tags.length < TAGS_LIMIT || tags.some((tag) => tag.committedDate < mergedAt);

  const candidates = tags
    .filter((tag) => tag.committedDate >= mergedAt)
    .sort((a, b) => a.committedDate.localeCompare(b.committedDate))
    .slice(0, MAX_COMPARES);

  for (const tag of candidates) {
    if (await tagContains(client, owner, repo, commit, tag)) {
      return {
        state: ReleaseStates.RELEASED,
        tag: tag.name,
        url: `https://github.com/${owner}/${repo}/releases/tag/${encodeURIComponent(tag.name)}`,
        exact,
      };
    }
  }

  return { state: ReleaseStates.UNRELEASED };
};
