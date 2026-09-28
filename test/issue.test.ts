import { RuleTester } from 'oxlint/plugins-dev';
import { createIssueRule } from '../src/plugin/rules.js';
import { fakeProvider, issue, linkedPullRequest, ok, pullRequest, setupRuleTester } from './fixtures.js';

setupRuleTester(RuleTester);

/** Joins the first line of a message with its indented detail lines. */
const lines = (...parts: Array<string>) => parts.join('\n  ');

const NEXT_RELEASED = (tag: string) => `Next: upgrade to ${tag} or later, then remove the comment.`;
const NEXT_UNRELEASED = 'Next: keep the comment until a release contains the fix, then upgrade and remove the comment.';

const released = (tag: string) =>
  ({ state: 'released', tag, url: `https://github.com/o/r/releases/tag/${tag}`, exact: true }) as const;

const provider = fakeProvider({
  'o/r#1': ok(issue()),
  'o/r#2': ok(pullRequest({ state: 'MERGED', mergedAt: '2026-09-20T00:00:00Z' })),
  'o/r#10': ok(
    issue({
      number: 10,
      state: 'CLOSED',
      stateReason: 'COMPLETED',
      closedAt: '2026-09-10T12:00:00Z',
      linkedPullRequests: [
        linkedPullRequest({ state: 'MERGED', mergedAt: '2026-09-10T11:00:00Z', release: released('v1.2.3') }),
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
  'o/r#14': ok(
    issue({
      number: 14,
      state: 'CLOSED',
      stateReason: 'COMPLETED',
      closedAt: '2026-09-14T00:00:00Z',
      linkedPullRequests: [
        linkedPullRequest({ state: 'MERGED', mergedAt: '2026-09-14T00:00:00Z', release: { state: 'unreleased' } }),
      ],
    }),
  ),
  'o/r#30': ok(
    issue({
      number: 30,
      linkedPullRequests: [
        linkedPullRequest({
          number: 31,
          state: 'MERGED',
          mergedAt: '2026-09-25T00:00:00Z',
          release: { state: 'unreleased' },
        }),
      ],
    }),
  ),
  'o/r#32': ok(
    issue({
      number: 32,
      linkedPullRequests: [
        linkedPullRequest({
          number: 33,
          state: 'MERGED',
          mergedAt: '2026-09-25T00:00:00Z',
          release: { state: 'unreleased' },
        }),
        linkedPullRequest({
          number: 34,
          state: 'MERGED',
          mergedAt: '2026-09-26T00:00:00Z',
          release: released('v3.1.0'),
        }),
      ],
    }),
  ),
  'o/r#35': ok(
    issue({
      number: 35,
      linkedPullRequests: [
        linkedPullRequest({ number: 36, state: 'CLOSED', closedAt: '2026-09-25T00:00:00Z' }),
        linkedPullRequest({ number: 37 }),
      ],
    }),
  ),
});

new RuleTester().run('issue', createIssueRule(provider), {
  valid: [
    '// TODO(o/r#1)',
    '// TODO(o/r#404)',
    /** A pull request is left to the pull-request rule. */
    '// TODO(o/r#2)',
    /** A linked pull request that was closed without merge, or is still open, needs no action. */
    '// TODO(o/r#35)',
    { code: '// TODO(o/r#30)', options: [{ linkedPullRequests: false }] },
    { code: '// TODO(o/r#30)', options: [{ waitForRelease: true }] },
    { code: '// TODO(o/r#14)', options: [{ waitForRelease: true }] },
    { code: '// TODO(o/r#11)', options: [{ states: ['completed', 'duplicate'] }] },
  ],
  invalid: [
    {
      code: '// TODO(o/r#10)',
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
      code: '// TODO(o/r#10)',
      options: [{ waitForRelease: true }],
      errors: [{ messageId: 'completed' }],
    },
    {
      code: '// TODO(o/r#14)',
      errors: [
        {
          message: lines(
            'o/r#14 "Crash on start" was closed as completed on 2026-09-14 by o/r#5 "Fix the crash", not released yet.',
            'URL: https://github.com/o/r/issues/14',
            NEXT_UNRELEASED,
          ),
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
            'Next: no fix will come from upstream. Remove the comment, or keep it as a plain comment without the reference.',
          ),
        },
      ],
    },
    {
      code: '// TODO(https://github.com/o/r/issues/12#issuecomment-1)',
      errors: [
        {
          message: lines(
            'o/r#12 "Crash on start" was closed as a duplicate of o/r#99 "Crash on boot" on 2026-09-12.',
            'URL: https://github.com/o/r/issues/12',
            'Next: replace "https://github.com/o/r/issues/12#issuecomment-1" with "https://github.com/o/r/issues/99".',
          ),
          suggestions: [{ messageId: 'replaceWithDuplicate', output: '// TODO(https://github.com/o/r/issues/99)' }],
        },
      ],
    },
    {
      code: '// TODO(o/r#12)',
      errors: [
        {
          messageId: 'duplicate',
          suggestions: [{ messageId: 'replaceWithDuplicate', output: '// TODO(o/r#99)' }],
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
            'Next: find the original issue on GitHub and replace the reference with it.',
          ),
          suggestions: null,
        },
      ],
    },
    {
      code: '// TODO(o/r#30)',
      errors: [
        {
          message: lines(
            'o/r#30 "Crash on start" is still open, but the linked pull request o/r#31 "Fix the crash" was merged on 2026-09-25, not released yet.',
            'URL: https://github.com/o/r/pull/31',
            NEXT_UNRELEASED,
          ),
        },
      ],
    },
    {
      code: '// TODO(o/r#32)',
      options: [{ waitForRelease: true }],
      errors: [
        {
          message: lines(
            'o/r#32 "Crash on start" is still open, but the linked pull request o/r#34 "Fix the crash" was merged on 2026-09-26, released in v3.1.0, and 1 more merged pull request.',
            'URL: https://github.com/o/r/pull/34',
            NEXT_RELEASED('v3.1.0'),
          ),
        },
      ],
    },
    {
      code: '// TODO(o/r#11)',
      settings: { 'todo-watch': { verbose: false } },
      errors: [{ message: 'o/r#11 "Crash on start" was closed as not planned on 2026-09-11.' }],
    },
    {
      code: '// FIXME(o/r#1, o/r#11)',
      errors: [{ messageId: 'notPlanned', column: 16 }],
    },
  ],
});
