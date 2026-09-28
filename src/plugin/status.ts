import type { Context } from '@oxlint/plugins';
import { FailureReasons, toRefKey, type StatusResult } from '../github/types.js';
import type { StatusProvider } from './provider.js';
import { getSettings, NetworkModes } from './settings.js';
import { findRefs, type RefInFile } from './todos.js';

/**
 * Loads the status of all references in the current file with one provider call and visits each
 * reference with its result. Errors of the provider become unavailable results. References
 * without a result, e.g. not in the cache in cache-only mode, are skipped.
 */
export const visitRefStatuses = (
  context: Context,
  provider: StatusProvider,
  visit: (found: RefInFile, result: StatusResult) => void,
): void => {
  const settings = getSettings(context.settings);
  if (settings.network === NetworkModes.OFF) return;

  const refs = findRefs(context, settings.keywords);
  if (refs.length === 0) return;

  let response: Record<string, StatusResult>;
  try {
    response = provider({
      refs: refs.map(({ ref }) => ({ owner: ref.owner, repo: ref.repo, number: ref.number })),
      cwd: context.cwd,
      keywords: settings.keywords,
      cacheTtl: settings.cacheTtl,
      prefetch: settings.prefetch,
      cacheOnly: settings.network === NetworkModes.CACHE_ONLY,
    });
  } catch (error) {
    const failure: StatusResult = {
      ok: false,
      reason: FailureReasons.UNAVAILABLE,
      message: error instanceof Error ? error.message : String(error),
      fetchedAt: new Date().toISOString(),
    };
    response = Object.fromEntries(refs.map(({ ref }) => [toRefKey(ref), failure]));
  }

  for (const found of refs) {
    const result = response[toRefKey(found.ref)];
    if (result) visit(found, result);
  }
};
