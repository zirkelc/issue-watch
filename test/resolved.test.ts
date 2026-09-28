import { RuleTester } from 'oxlint/plugins-dev';
import { createResolvedRule } from '../src/plugin/rules.js';
import { fakeProvider, issue, linkedPullRequest, ok, pullRequest, setupRuleTester } from './fixtures.js';

setupRuleTester(RuleTester);

const SEEN = 'seen=2026-09-01T00:00Z';

/** Joins the first line of a message with its indented detail lines. */
const lines = (...parts: Array<string>) => parts.join('\n  ');

const NEXT_RELEASED = (tag: string) => `Next: upgrade to ${tag} or later, then remove the TODO and its workaround.`;
const NEXT_UNRELEASED =
  'Next: keep the workaround until a release contains the fix. Then upgrade and remove the TODO and its workaround.';

const provider = fakeProvider({
  'o/r#1': ok(issue()),
  'o/r#2': ok(pullRequest()),
  'o/r#10': ok(
    issue({
      number: 10,
      state: 'CLOSED',
      stateReason: 'COMPLETED',
      closedAt: '2026-09-10T12:00:00Z',
      linkedPullRequests: [
        linkedPullRequest({
          state: 'MERGED',
          mergedAt: '2026-09-10T11:00:00Z',
          release: { state: 'released', tag: 'v1.2.3', url: 'https://github.com/o/r/releases/tag/v1.2.3', exact: true },
        }),
      ],
    }),
  ),
  'o/r#11': ok(issue({ number: 11, state: 'CLOSED', stateReason: 'NOT_PLANNED', closedAt: '2026-09-11T00:00:00Z' })),
  'o/r#12': ok(
    issue({
      number: 12,
      state: 'CLOSED',
      stateReason: 'DUPLICATE',
      closedAt: '2026-09-12T00:00:00Z',
      duplicateOf: {
        owner: 'o',
        repo: 'r',
        number: 99,
        title: 'Crash on boot',
        url: 'https://github.com/o/r/issues/99',
      },
    }),
  ),
  'o/r#13': ok(issue({ number: 13, state: 'CLOSED', stateReason: 'DUPLICATE', closedAt: '2026-09-13T00:00:00Z' })),
  'o/r#20': ok(
    pullRequest({
      number: 20,
      state: 'MERGED',
      mergedAt: '2026-09-20T00:00:00Z',
      closedAt: '2026-09-20T00:00:00Z',
      release: { state: 'unreleased' },
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
  'o/r#21': ok(pullRequest({ number: 21, state: 'CLOSED', closedAt: '2026-09-21T00:00:00Z' })),
  'o/r#22': ok(
    pullRequest({
      number: 22,
      state: 'MERGED',
      mergedAt: '2026-09-22T00:00:00Z',
      release: { state: 'released', tag: 'v2.0.0', url: 'https://github.com/o/r/releases/tag/v2.0.0', exact: true },
    }),
  ),
});

new RuleTester().run('resolved', createResolvedRule(provider), {
  valid: [
    `// TODO(o/r#1 ${SEEN})`,
    `// TODO(https://github.com/o/r/pull/2 ${SEEN})`,
    '// TODO(o/r#404)',
    {
      code: `// TODO(o/r#20 ${SEEN})`,
      options: [{ waitForRelease: true }],
    },
  ],
  invalid: [
    {
      code: `// TODO(o/r#10 ${SEEN})`,
      errors: [
        {
          message: lines(
            'o/r#10 "Crash on start" was closed as completed on 2026-09-10 by o/r#5 "Fix the crash", released in v1.2.3.',
            'URL: https://github.com/o/r/issues/10',
            NEXT_RELEASED('v1.2.3'),
          ),
          line: 1,
          column: 8,
          endColumn: 14,
        },
      ],
    },
    {
      code: '// TODO(o/r#11)',
      errors: [
        {
          message: lines(
            'o/r#11 "Crash on start" was closed as not planned on 2026-09-11.',
            'URL: https://github.com/o/r/issues/11',
            'Next: no fix will come from upstream. Keep the workaround, and replace the TODO with a normal comment that explains it.',
          ),
        },
      ],
    },
    {
      code: `// TODO(https://github.com/o/r/issues/12#issuecomment-1 ${SEEN})`,
      errors: [
        {
          message: lines(
            'o/r#12 "Crash on start" was closed as a duplicate of o/r#99 "Crash on boot" on 2026-09-12.',
            'URL: https://github.com/o/r/issues/12',
            'Next: replace "https://github.com/o/r/issues/12#issuecomment-1" with "https://github.com/o/r/issues/99". Keep the seen marker.',
          ),
          suggestions: [
            {
              messageId: 'replaceWithDuplicate',
              output: `// TODO(https://github.com/o/r/issues/99 ${SEEN})`,
            },
          ],
        },
      ],
    },
    {
      code: `// TODO(o/r#12 ${SEEN})`,
      errors: [
        {
          messageId: 'duplicate',
          suggestions: [{ messageId: 'replaceWithDuplicate', output: `// TODO(o/r#99 ${SEEN})` }],
        },
      ],
    },
    {
      code: '// TODO(o/r#13)',
      errors: [
        {
          message: lines(
            'o/r#13 "Crash on start" was closed as a duplicate of another issue on 2026-09-13.',
            'URL: https://github.com/o/r/issues/13',
            'Next: find the original issue on GitHub and replace the TODO reference with it. Keep the seen marker.',
          ),
          suggestions: null,
        },
      ],
    },
    {
      code: `// TODO(o/r#20 ${SEEN})`,
      errors: [
        {
          message: lines(
            'o/r#20 "Fix crash on start" was merged on 2026-09-20, not released yet.',
            'URL: https://github.com/o/r/pull/20',
            NEXT_UNRELEASED,
          ),
        },
      ],
    },
    {
      code: `// TODO(o/r#21 ${SEEN})`,
      errors: [
        {
          message: lines(
            'o/r#21 "Fix crash on start" was closed without merge on 2026-09-21.',
            'URL: https://github.com/o/r/pull/21',
            'Next: find out if another pull request replaces it. Then update the TODO reference, or keep the workaround and remove the TODO.',
          ),
        },
      ],
    },
    {
      code: `// TODO(o/r#22 ${SEEN})`,
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
      code: `// TODO(o/r#23 ${SEEN})`,
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
      code: `// TODO(o/r#20 ${SEEN})`,
      settings: { 'todo-watch': { verbose: false } },
      errors: [{ message: 'o/r#20 "Fix crash on start" was merged on 2026-09-20, not released yet.' }],
    },
    {
      code: `// FIXME(o/r#1 ${SEEN}, o/r#21 ${SEEN})`,
      errors: [{ messageId: 'closedUnmerged', column: 39 }],
    },
  ],
});
