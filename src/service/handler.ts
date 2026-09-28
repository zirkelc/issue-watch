import { createClient, resolveToken, type GithubClient } from '../github/client.js';
import { fetchStatuses, type CachedRelease } from '../github/fetch-statuses.js';
import { FailureReasons, toRefKey, type RefId, type RefKey, type StatusResult } from '../github/types.js';
import { emptyCache, readCache, resolveCacheFile, writeCache, type CacheData } from './cache.js';
import { scanRefs } from './scan.js';

export type StatusRequest = {
  refs: Array<RefId>;
  cwd: string;
  keywords: Array<string>;
  /** How long a fetched status stays valid, in minutes. */
  cacheTtl: number;
  /** Scan the repository once and fetch all references together. */
  prefetch: boolean;
  /** Answer from the cache file only, without requests. */
  cacheOnly?: boolean;
};

export type StatusResponse = Record<RefKey, StatusResult>;

export type HandlerDeps = {
  createClient: (token: string) => GithubClient;
  resolveToken: () => string | undefined;
  now: () => Date;
  scan: (cwd: string, keywords: Array<string>) => Array<RefId>;
  cacheFile: (cwd: string) => string | undefined;
};

const MINUTE_MS = 60_000;

const defaultDeps: HandlerDeps = {
  createClient,
  resolveToken,
  now: () => new Date(),
  scan: scanRefs,
  cacheFile: resolveCacheFile,
};

/**
 * Only real answers from GitHub are cached. Network or auth problems are retried on the next run.
 */
const isCacheable = (result: StatusResult) => result.ok || result.reason === FailureReasons.NOT_FOUND;

/**
 * Creates the request handler that runs in the worker thread. It keeps the cache in memory, reads
 * it from disk once per project and writes it back after each fetch.
 */
export const createStatusHandler = (overrides: Partial<HandlerDeps> = {}) => {
  const deps = { ...defaultDeps, ...overrides };
  const caches = new Map<string, CacheData>();
  const scanned = new Set<string>();
  let client: GithubClient | undefined;
  let token: string | null | undefined;

  const getClient = () => {
    if (token === undefined) token = deps.resolveToken() ?? null;
    if (token && !client) client = deps.createClient(token);
    return client;
  };

  return async (request: StatusRequest): Promise<StatusResponse> => {
    const { cwd } = request;
    const file = deps.cacheFile(cwd);

    let cache = caches.get(cwd);
    if (!cache) {
      cache = file ? readCache(file) : emptyCache();
      caches.set(cwd, cache);
    }

    const now = deps.now();
    const ttlMs = request.cacheTtl * MINUTE_MS;
    const isFresh = (key: RefKey) => {
      const cached = cache.statuses[key];
      return cached !== undefined && now.getTime() - new Date(cached.fetchedAt).getTime() < ttlMs;
    };

    const wanted = new Map(request.refs.map((ref) => [toRefKey(ref), ref]));
    if (request.prefetch && !scanned.has(cwd)) {
      scanned.add(cwd);
      for (const ref of deps.scan(cwd, request.keywords)) {
        const key = toRefKey(ref);
        if (!wanted.has(key)) wanted.set(key, ref);
      }
    }

    const missing = [...wanted].filter(([key]) => !isFresh(key)).map(([, ref]) => ref);
    const fetched = new Map<RefKey, StatusResult>();

    if (missing.length > 0) {
      const github = getClient();
      if (!github) {
        for (const ref of missing) {
          fetched.set(toRefKey(ref), {
            ok: false,
            reason: FailureReasons.UNAVAILABLE,
            message: 'No GitHub token found. Set GITHUB_TOKEN or GH_TOKEN, or log in with the GitHub CLI.',
            fetchedAt: now.toISOString(),
          });
        }
      } else {
        const releaseCache = new Map<string, CachedRelease>(Object.entries(cache.releases));
        const results = await fetchStatuses(github, missing, { now: deps.now, releaseCache, releaseTtlMs: ttlMs });

        for (const [key, result] of results) {
          fetched.set(key, result);
          if (isCacheable(result)) cache.statuses[key] = result;
        }
        cache.releases = Object.fromEntries(releaseCache);
        if (file) writeCache(file, cache);
      }
    }

    const response: StatusResponse = {};
    for (const ref of request.refs) {
      const key = toRefKey(ref);
      response[key] = fetched.get(key) ?? cache.statuses[key]!;
    }
    return response;
  };
};
