import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CachedRelease } from '../github/fetch-statuses.js';
import type { RefKey, StatusResult } from '../github/types.js';

const CACHE_VERSION = 4;

export type CacheData = {
  version: typeof CACHE_VERSION;
  statuses: Record<RefKey, StatusResult>;
  releases: Record<string, CachedRelease>;
};

export const emptyCache = (): CacheData => ({ version: CACHE_VERSION, statuses: {}, releases: {} });

/**
 * Stores the cache in `node_modules/.cache` like other tools, or in the temp directory if the
 * project has no `node_modules`.
 */
export const resolveCacheFile = (cwd: string): string => {
  const nodeModules = join(cwd, 'node_modules');
  if (existsSync(nodeModules)) return join(nodeModules, '.cache', 'todo-watch', 'github.json');

  const hash = createHash('sha1').update(cwd).digest('hex').slice(0, 12);
  return join(tmpdir(), 'todo-watch', `${hash}.json`);
};

export const readCache = (file: string): CacheData => {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as Partial<CacheData>;
    if (data.version !== CACHE_VERSION) return emptyCache();
    return { version: CACHE_VERSION, statuses: data.statuses ?? {}, releases: data.releases ?? {} };
  } catch {
    return emptyCache();
  }
};

/**
 * Writes to a temporary file first, so a parallel reader never sees a half-written cache.
 */
export const writeCache = (file: string, data: CacheData): void => {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(data));
    renameSync(temporary, file);
  } catch {
    /** A cache that cannot be written only costs speed. */
  }
};
