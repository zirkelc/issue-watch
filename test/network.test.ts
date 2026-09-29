import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuleTester } from 'oxlint/plugins-dev';
import { describe, expect, test } from 'vitest';
import { createWorkerProvider } from '../src/plugin/provider.js';
import { createPullRequestRule } from '../src/plugin/rules.js';
import { emptyCache, resolveCacheFile, writeCache } from '../src/service/cache.js';
import { issue, ok, pullRequest, setupRuleTester } from './fixtures.js';

setupRuleTester(RuleTester);

const request = (cwd: string, numbers: Array<number>) => ({
  refs: numbers.map((number) => ({ owner: 'o', repo: 'r', number })),
  cwd,
  keywords: ['TODO'],
  cacheTtl: 60,
  prefetch: true,
  cacheOnly: true,
});

describe('createWorkerProvider in cache-only mode', () => {
  test(`should answer from the cache file without a worker`, () => {
    // Arrange
    const cwd = mkdtempSync(join(tmpdir(), 'issue-watch-cache-'));
    mkdirSync(join(cwd, 'node_modules'));
    const cache = emptyCache();
    cache.statuses['o/r#1'] = { ...ok(issue()), fetchedAt: '2020-01-01T00:00:00.000Z' };
    writeCache(resolveCacheFile(cwd), cache);
    const provider = createWorkerProvider('/does/not/exist.mjs');

    // Act
    const response = provider(request(cwd, [1, 2]));

    // Assert
    expect(Object.keys(response)).toEqual(['o/r#1']);
    expect(response['o/r#1']?.ok).toBe(true);
  });

  test(`should answer nothing without a cache file`, () => {
    // Arrange
    const cwd = mkdtempSync(join(tmpdir(), 'issue-watch-cache-'));
    const provider = createWorkerProvider('/does/not/exist.mjs');

    // Act
    const response = provider(request(cwd, [1]));

    // Assert
    expect(response).toEqual({});
  });
});

const throwingProvider = () => {
  throw new Error('must not be called');
};

new RuleTester().run('pull-request with network off', createPullRequestRule(throwingProvider), {
  valid: [
    {
      code: `// TODO(o/r#2)`,
      settings: { 'issue-watch': { network: 'off' } },
    },
  ],
  invalid: [],
});

new RuleTester().run(
  'pull-request in cache-only mode',
  createPullRequestRule((received) => {
    expect(received.cacheOnly).toBe(true);
    return { 'o/r#2': ok(pullRequest({ state: 'CLOSED', closedAt: '2026-09-21T00:00:00Z' })) };
  }),
  {
    valid: [],
    invalid: [
      {
        code: `// TODO(o/r#2)`,
        settings: { 'issue-watch': { network: 'cache-only', verbose: false } },
        errors: [{ message: 'o/r#2 "Fix crash on start" was closed without merge on 2026-09-21.' }],
      },
    ],
  },
);
