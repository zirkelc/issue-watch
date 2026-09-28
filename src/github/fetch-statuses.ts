import type { GithubClient, GraphqlError } from './client.js';
import { aliasOf, buildStatusQuery, normalizeStatus, type RawStatusData } from './query.js';
import { fetchTags, findRelease, type Tag } from './release.js';
import {
  FailureReasons,
  PullRequestStates,
  RefTypes,
  ReleaseStates,
  toRefKey,
  type RefId,
  type RefKey,
  type Release,
  type RefStatus,
  type StatusResult,
} from './types.js';

const BATCH_SIZE = 20;
const MAX_LINKED_RELEASES = 3;

export type CachedRelease = {
  release: Release;
  fetchedAt: string;
};

export type FetchOptions = {
  now: () => Date;
  /** Release lookups by `owner/repo@commit`. Found releases never expire. */
  releaseCache: Map<string, CachedRelease>;
  /** How long an unreleased or unknown result stays valid. */
  releaseTtlMs: number;
};

const chunk = <ITEM>(items: Array<ITEM>, size: number): Array<Array<ITEM>> =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const unavailable = (message: string, fetchedAt: string): StatusResult => ({
  ok: false,
  reason: FailureReasons.UNAVAILABLE,
  message,
  fetchedAt,
});

const notFound = (ref: RefId, fetchedAt: string): StatusResult => ({
  ok: false,
  reason: FailureReasons.NOT_FOUND,
  message: `${ref.owner}/${ref.repo}#${ref.number} was not found, or the token has no access to it.`,
  fetchedAt,
});

const HTML_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/;

/**
 * GraphQL does not follow transferred issues. The REST API redirects to the new location, which
 * gives the new owner and repo.
 */
const findTransferred = async (client: GithubClient, ref: RefId): Promise<RefId | undefined> => {
  try {
    const response = await client.rest<{ html_url?: string }>(`/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`);
    const match = response.status === 200 ? HTML_URL_RE.exec(response.data.html_url ?? '') : null;
    if (!match) return undefined;

    const moved = { owner: match[1]!, repo: match[2]!, number: Number(match[3]) };
    return toRefKey(moved) === toRefKey(ref) ? undefined : moved;
  } catch {
    return undefined;
  }
};

type BatchResult = {
  statuses: Map<RefKey, RefStatus>;
  failures: Map<RefKey, StatusResult>;
};

const fetchBatch = async (client: GithubClient, refs: Array<RefId>, fetchedAt: string): Promise<BatchResult> => {
  const statuses = new Map<RefKey, RefStatus>();
  const failures = new Map<RefKey, StatusResult>();

  let response: { data?: RawStatusData | null; errors?: Array<GraphqlError> };
  try {
    response = await client.graphql<RawStatusData>(buildStatusQuery(refs));
  } catch (error) {
    for (const ref of refs) failures.set(toRefKey(ref), unavailable(errorMessage(error), fetchedAt));
    return { statuses, failures };
  }

  const data = response.data;
  if (!data) {
    const message = response.errors?.map((error) => error.message).join('; ') || 'Empty response from GitHub.';
    for (const ref of refs) failures.set(toRefKey(ref), unavailable(message, fetchedAt));
    return { statuses, failures };
  }

  refs.forEach((ref, index) => {
    const key = toRefKey(ref);
    const raw = data[aliasOf(index)]?.issueOrPullRequest;

    if (raw) {
      statuses.set(key, normalizeStatus(raw));
      return;
    }

    const error = response.errors?.find((candidate) => candidate.path?.[0] === aliasOf(index));
    failures.set(
      key,
      !error || error.type === 'NOT_FOUND' ? notFound(ref, fetchedAt) : unavailable(error.message, fetchedAt),
    );
  });

  return { statuses, failures };
};

type ReleaseLookup = {
  client: GithubClient;
  options: FetchOptions;
  tags: Map<string, Promise<Array<Tag>>>;
};

const lookupRelease = async (
  lookup: ReleaseLookup,
  owner: string,
  repo: string,
  commit: string | undefined,
  mergedAt: string | undefined,
): Promise<Release | undefined> => {
  if (!commit || !mergedAt) return { state: ReleaseStates.UNKNOWN };

  const { client, options } = lookup;
  const cacheKey = `${owner.toLowerCase()}/${repo.toLowerCase()}@${commit}`;
  const cached = options.releaseCache.get(cacheKey);
  const now = options.now();
  if (
    cached &&
    (cached.release.state === ReleaseStates.RELEASED ||
      now.getTime() - new Date(cached.fetchedAt).getTime() < options.releaseTtlMs)
  ) {
    return cached.release;
  }

  try {
    const repoKey = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
    let tags = lookup.tags.get(repoKey);
    if (!tags) {
      tags = fetchTags(client, owner, repo);
      lookup.tags.set(repoKey, tags);
    }

    const release = await findRelease(client, owner, repo, commit, mergedAt, await tags);
    options.releaseCache.set(cacheKey, { release, fetchedAt: now.toISOString() });
    return release;
  } catch {
    return undefined;
  }
};

const addReleases = async (lookup: ReleaseLookup, status: RefStatus): Promise<RefStatus> => {
  if (status.type === RefTypes.PULL_REQUEST) {
    if (status.state !== PullRequestStates.MERGED) return status;
    const release = await lookupRelease(lookup, status.owner, status.repo, status.mergeCommit, status.mergedAt);
    return { ...status, release };
  }

  const merged = new Set(
    status.linkedPullRequests
      .filter((linked) => linked.state === PullRequestStates.MERGED)
      .slice(0, MAX_LINKED_RELEASES),
  );
  const linkedPullRequests = await Promise.all(
    status.linkedPullRequests.map(async (linked) =>
      merged.has(linked)
        ? {
            ...linked,
            release: await lookupRelease(lookup, linked.owner, linked.repo, linked.mergeCommit, linked.mergedAt),
          }
        : linked,
    ),
  );

  return { ...status, linkedPullRequests };
};

/**
 * Fetches the status of many references with as few requests as possible. Every requested
 * reference gets a result, also if GitHub cannot be reached.
 */
export const fetchStatuses = async (
  client: GithubClient,
  refs: Array<RefId>,
  options: FetchOptions,
): Promise<Map<RefKey, StatusResult>> => {
  const fetchedAt = options.now().toISOString();
  const results = new Map<RefKey, StatusResult>();
  const lookup: ReleaseLookup = { client, options, tags: new Map() };

  const unique = [...new Map(refs.map((ref) => [toRefKey(ref), ref])).values()];
  const batches = await Promise.all(chunk(unique, BATCH_SIZE).map((batch) => fetchBatch(client, batch, fetchedAt)));

  const statuses = new Map(batches.flatMap((batch) => [...batch.statuses]));
  const failures = new Map(batches.flatMap((batch) => [...batch.failures]));

  const withReleases = (entries: Iterable<[RefKey, RefStatus]>) =>
    Promise.all([...entries].map(async ([key, status]) => [key, await addReleases(lookup, status)] as const));

  /** Resolves issues that were transferred to another repo, while releases are looked up. */
  const resolveTransferred = async () => {
    const transferred = new Map<RefKey, RefId>();
    await Promise.all(
      [...failures].map(async ([key, failure]) => {
        if (failure.ok || failure.reason !== FailureReasons.NOT_FOUND) return;
        const ref = unique.find((candidate) => toRefKey(candidate) === key)!;
        const moved = await findTransferred(client, ref);
        if (moved) transferred.set(key, moved);
      }),
    );
    if (transferred.size === 0) return [];

    const movedBatch = await fetchBatch(client, [...transferred.values()], fetchedAt);
    const found: Array<[RefKey, RefStatus]> = [];
    for (const [key, moved] of transferred) {
      const status = movedBatch.statuses.get(toRefKey(moved));
      if (status) found.push([key, status]);
    }
    return withReleases(found);
  };

  const [released, moved] = await Promise.all([withReleases(statuses), resolveTransferred()]);

  for (const [key, status] of [...released, ...moved]) {
    failures.delete(key);
    results.set(key, { ok: true, status, fetchedAt });
  }
  for (const [key, failure] of failures) results.set(key, failure);

  return results;
};
