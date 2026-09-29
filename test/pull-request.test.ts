import { RuleTester } from 'oxlint/plugins-dev';
import { createPullRequestRule } from '../src/plugin/rules.js';
import { fakeProvider, issue, ok, pullRequest, setupRuleTester } from './fixtures.js';

setupRuleTester(RuleTester);

/** Joins the first line of a message with its indented detail lines. */
const lines = (...parts: Array<string>) => parts.join('\n  ');

const NEXT_RELEASED = (tag: string) => `Next: upgrade to ${tag} or later, then remove the comment.`;
const NEXT_UNRELEASED = 'Next: keep the comment until a release contains the fix, then upgrade and remove the comment.';

const provider = fakeProvider({
  'o/r#1': ok(issue({ state: 'CLOSED', stateReason: 'COMPLETED', closedAt: '2026-09-10T00:00:00Z' })),
  'o/r#2': ok(pullRequest()),
  'o/r#20': ok(
    pullRequest({
      number: 20,
      state: 'MERGED',
      mergedAt: '2026-09-20T00:00:00Z',
      closedAt: '2026-09-20T00:00:00Z',
      release: { state: 'unreleased' },
    }),
  ),
  'o/r#21': ok(pullRequest({ number: 21, state: 'CLOSED', closedAt: '2026-09-21T00:00:00Z' })),
  'o/r#22': ok(
    pullRequest({
      number: 22,
      state: 'MERGED',
      mergedAt: '2026-09-22T00:00:00Z',
      release: { state: 'released', tag: 'v2.0.0', url: 'https://github.com/o/r/releases/tag/v2.0.0', exact: true },
    }),
  ),
  'o/r#23': ok(
    pullRequest({
      number: 23,
      state: 'MERGED',
      mergedAt: '2016-01-01T00:00:00Z',
      release: { state: 'released', tag: 'v9.0.0', url: 'https://github.com/o/r/releases/tag/v9.0.0', exact: false },
    }),
  ),
});

new RuleTester().run('pull-request', createPullRequestRule(provider), {
  valid: [
    '// TODO(https://github.com/o/r/pull/2)',
    '// TODO(o/r#404)',
    /** An issue is left to the issue rule. */
    '// TODO(o/r#1)',
    { code: '// TODO(o/r#20)', options: [{ waitForRelease: true }] },
    { code: '// TODO(o/r#21)', options: [{ states: ['merged'] }] },
    { code: '// TODO(o/r#22)', options: [{ states: ['closed'] }] },
  ],
  invalid: [
    {
      code: '// TODO(o/r#20)',
      errors: [
        {
          message: lines(
            'o/r#20 "Fix crash on start" was merged on 2026-09-20, not released yet.',
            'URL: https://github.com/o/r/pull/20',
            NEXT_UNRELEASED,
          ),
          line: 1,
          column: 8,
          endColumn: 14,
        },
      ],
    },
    {
      code: '// TODO(o/r#21)',
      errors: [
        {
          message: lines(
            'o/r#21 "Fix crash on start" was closed without merge on 2026-09-21.',
            'URL: https://github.com/o/r/pull/21',
            'Next: find out if another pull request replaces it, then update the reference or remove the comment.',
          ),
        },
      ],
    },
    {
      code: '// TODO(o/r#22)',
      options: [{ waitForRelease: true }],
      errors: [
        {
          message: lines(
            'o/r#22 "Fix crash on start" was merged on 2026-09-22, released in v2.0.0.',
            'URL: https://github.com/o/r/pull/22',
            NEXT_RELEASED('v2.0.0'),
          ),
        },
      ],
    },
    {
      code: '// TODO(o/r#23)',
      errors: [
        {
          message: lines(
            'o/r#23 "Fix crash on start" was merged on 2016-01-01, released in v9.0.0 or earlier.',
            'URL: https://github.com/o/r/pull/23',
            NEXT_RELEASED('v9.0.0'),
          ),
        },
      ],
    },
    {
      code: '// TODO(o/r#20)',
      settings: { 'issue-watch': { verbose: false } },
      errors: [{ message: 'o/r#20 "Fix crash on start" was merged on 2026-09-20, not released yet.' }],
    },
    {
      code: '// TODO(o/r#2, o/r#21)',
      errors: [{ messageId: 'closedUnmerged', column: 15 }],
    },
  ],
});
