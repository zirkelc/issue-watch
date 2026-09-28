import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSyncFn } from 'synckit';
import { FailureReasons, toRefKey, type RefKey, type StatusResult } from '../github/types.js';
import { readCache, resolveCacheFile, type CacheData } from '../service/cache.js';
import type { StatusRequest, StatusResponse } from '../service/handler.js';

/**
 * Returns the status of references synchronously, because lint rules cannot wait for promises.
 */
export type StatusProvider = (request: StatusRequest) => StatusResponse;

const MINUTE_MS = 60_000;
const WORKER_TIMEOUT_MS = 120_000;

/**
 * Failures are kept in memory for a short time only, so a short network problem does not hide
 * the status for a whole cache period in a long-running editor session.
 */
const FAILURE_TTL_MS = MINUTE_MS;

/**
 * Reads statuses from the cache file without any request. The file is read again only when it
 * changed, e.g. after the CLI refreshed it.
 */
const createCacheReader = () => {
  const loaded = new Map<string, { mtimeMs: number; data: CacheData }>();

  return (request: StatusRequest): StatusResponse => {
    const file = resolveCacheFile(request.cwd);
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(file).mtimeMs;
    } catch {
      return {};
    }

    let entry = loaded.get(file);
    if (!entry || entry.mtimeMs !== mtimeMs) {
      entry = { mtimeMs, data: readCache(file) };
      loaded.set(file, entry);
    }

    const { statuses } = entry.data;
    return Object.fromEntries(
      request.refs.flatMap((ref) => {
        const result = statuses[toRefKey(ref)];
        return result ? [[toRefKey(ref), result]] : [];
      }),
    );
  };
};

/**
 * Creates a provider that runs the network requests in a worker thread and blocks until the
 * worker answers. Results stay in memory, so the rules of the same file and later files do not
 * ask the worker again. In cache-only mode, it reads the cache file and starts no worker.
 */
export const createWorkerProvider = (
  workerPath: string = fileURLToPath(new URL('./worker.mjs', import.meta.url)),
): StatusProvider => {
  let call: ((request: StatusRequest) => StatusResponse) | undefined;
  const memo = new Map<RefKey, StatusResult>();
  const readCached = createCacheReader();

  return (request) => {
    if (request.cacheOnly) return readCached(request);

    const now = Date.now();
    const isFresh = (result: StatusResult | undefined) =>
      result !== undefined &&
      now - new Date(result.fetchedAt).getTime() <
        (result.ok || result.reason === FailureReasons.NOT_FOUND ? request.cacheTtl * MINUTE_MS : FAILURE_TTL_MS);

    const missing = request.refs.filter((ref) => !isFresh(memo.get(toRefKey(ref))));
    if (missing.length > 0) {
      call ??= createSyncFn(workerPath, { timeout: WORKER_TIMEOUT_MS });

      try {
        const response = call({ ...request, refs: missing });
        for (const [key, result] of Object.entries(response)) memo.set(key, result);
      } catch (error) {
        for (const ref of missing) {
          memo.set(toRefKey(ref), {
            ok: false,
            reason: FailureReasons.UNAVAILABLE,
            message: error instanceof Error ? error.message : String(error),
            fetchedAt: new Date(now).toISOString(),
          });
        }
      }
    }

    return Object.fromEntries(request.refs.map((ref) => [toRefKey(ref), memo.get(toRefKey(ref))!]));
  };
};
