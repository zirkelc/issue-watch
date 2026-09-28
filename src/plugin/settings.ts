import type { Settings } from '@oxlint/plugins';
import { DEFAULT_KEYWORDS } from '../parse.js';

export const PLUGIN_NAME = 'todo-watch';

const DEFAULT_CACHE_TTL_MINUTES = 60;

export const NetworkModes = {
  /** Fetch from GitHub when the cache is older than the cache TTL. */
  FETCH: 'fetch',
  /** Read the cache only. The CLI fills it. */
  CACHE_ONLY: 'cache-only',
  /** No network rules. Only the format rule reports. */
  OFF: 'off',
} as const;

export type NetworkMode = (typeof NetworkModes)[keyof typeof NetworkModes];

/**
 * Settings shared by all rules, configured under `settings["todo-watch"]`.
 */
export type TodoWatchSettings = {
  /** Comment keywords that are followed by references in parentheses. */
  keywords: Array<string>;
  /** How long a fetched status stays valid, in minutes. */
  cacheTtl: number;
  /** Scan the repository once and fetch all references in one request. */
  prefetch: boolean;
  /**
   * Add the URL, the first new comment and the next step to each message, so that a person or an
   * agent can act without opening GitHub first.
   */
  verbose: boolean;
  /** How the network rules get the status of references. */
  network: NetworkMode;
};

const NETWORK_MODES = new Set<string>(Object.values(NetworkModes));

export const getSettings = (settings: Readonly<Settings>): TodoWatchSettings => {
  const raw = settings[PLUGIN_NAME];
  const own = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  const keywords = Array.isArray(own.keywords)
    ? own.keywords.filter((keyword): keyword is string => typeof keyword === 'string' && keyword.length > 0)
    : DEFAULT_KEYWORDS;
  const cacheTtl =
    typeof own.cacheTtl === 'number' && Number.isFinite(own.cacheTtl) && own.cacheTtl >= 0
      ? own.cacheTtl
      : DEFAULT_CACHE_TTL_MINUTES;
  const prefetch = typeof own.prefetch === 'boolean' ? own.prefetch : true;
  const verbose = typeof own.verbose === 'boolean' ? own.verbose : true;
  const network =
    typeof own.network === 'string' && NETWORK_MODES.has(own.network)
      ? (own.network as NetworkMode)
      : NetworkModes.FETCH;

  return { keywords, cacheTtl, prefetch, verbose, network };
};
