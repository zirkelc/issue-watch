import { RuleTester } from 'oxlint/plugins-dev';
import { createActivityRule } from '../src/plugin/rules.js';
import { fakeProvider, issue, linkedPullRequest, ok, pullRequest, setupRuleTester } from './fixtures.js';

setupRuleTester(RuleTester);

const SEEN = 'seen=2026-09-01T10:00Z';
const MARKED = 'seen=2026-09-28T10:15Z';

const user = (login: string) => ({ login, isBot: false });
const bot = { login: 'renovate[bot]', isBot: true };

const comment = (id: number, createdAt: string, author = user('alice'), body = `Comment ${id}`) => ({
  url: `https://github.com/o/r/issues/1#issuecomment-${id}`,
  createdAt,
  body,
  author,
});

/** Joins the first line of a message with its indented detail lines. */
const lines = (...parts: Array<string>) => parts.join('\n  ');

const next = (seen: string) =>
  `Next: read the news and update the code if needed. Then mark it as seen: replace "${seen}" with "${MARKED}".`;

const provider = fakeProvider({
  'o/r#1': ok(
    issue({
      comments: [
        comment(1, '2026-08-01T00:00:00Z'),
        /** Inside the seen minute, so it counts as seen. */
        comment(2, '2026-09-01T10:00:30Z'),
        comment(3, '2026-09-02T00:00:00Z'),
        comment(4, '2026-09-03T00:00:00Z', user('me')),
        comment(5, '2026-09-04T00:00:00Z', bot),
      ],
    }),
  ),
  'o/r#3': ok(
    issue({
      number: 3,
      events: [
        { type: 'reopened', createdAt: '2026-09-05T00:00:00Z' },
        { type: 'labeled', createdAt: '2026-09-05T00:00:00Z', detail: 'bug' },
        { type: 'milestoned', createdAt: '2026-09-05T00:00:00Z', detail: 'v2' },
      ],
    }),
  ),
  'o/r#4': ok(
    issue({
      number: 4,
      linkedPullRequests: [
        linkedPullRequest({ number: 5, linkedAt: '2026-09-06T00:00:00Z' }),
        linkedPullRequest({
          number: 6,
          state: 'MERGED',
          linkedAt: '2026-08-01T00:00:00Z',
          mergedAt: '2026-09-07T00:00:00Z',
          release: { state: 'unreleased' },
        }),
        linkedPullRequest({
          number: 7,
          state: 'CLOSED',
          linkedAt: '2026-08-01T00:00:00Z',
          closedAt: '2026-09-08T00:00:00Z',
        }),
      ],
    }),
  ),
  'o/r#8': ok(
    pullRequest({
      number: 8,
      events: [
        { type: 'ready-for-review', createdAt: '2026-09-09T00:00:00Z' },
        { type: 'converted-to-draft', createdAt: '2026-08-01T00:00:00Z' },
      ],
      reviews: [
        { state: 'APPROVED', url: 'https://x', createdAt: '2026-09-10T00:00:00Z', author: user('bob') },
        { state: 'CHANGES_REQUESTED', url: 'https://x', createdAt: '2026-09-11T00:00:00Z', author: user('carol') },
        { state: 'COMMENTED', url: 'https://x', createdAt: '2026-09-11T00:00:00Z', author: user('dave') },
      ],
    }),
  ),
  'o/r#9': ok(
    issue({
      number: 9,
      state: 'CLOSED',
      closedAt: '2026-09-02T00:00:00Z',
      comments: [comment(6, '2026-09-02T00:00:00Z')],
      events: [{ type: 'closed', createdAt: '2026-09-02T00:00:00Z', detail: 'not planned' }],
    }),
  ),
  'o/r#12': ok(
    pullRequest({
      number: 12,
      state: 'MERGED',
      mergedAt: '2026-09-03T00:00:00Z',
      closedAt: '2026-09-03T00:00:00Z',
      release: { state: 'released', tag: 'v2.0.0', url: 'https://github.com/o/r/releases/tag/v2.0.0', exact: true },
      events: [{ type: 'closed', createdAt: '2026-09-03T00:00:01Z' }],
    }),
  ),
  'o/r#13': ok(
    pullRequest({
      number: 13,
      state: 'CLOSED',
      closedAt: '2026-09-04T00:00:00Z',
      events: [{ type: 'closed', createdAt: '2026-09-04T00:00:00Z' }],
    }),
  ),
  'o/r#10': ok(issue({ number: 10, comments: [comment(7, '2026-08-01T00:00:00Z')] })),
  'o/r#11': ok(
    issue({
      number: 11,
      comments: [comment(8, '2026-09-02T00:00:00Z', user('alice'), `First line.\n\n${'word '.repeat(60)}`)],
    }),
  ),
});

new RuleTester().run('activity', createActivityRule(provider), {
  valid: [
    `// TODO(o/r#10 ${SEEN})`,
    `// TODO(o/r#9 ${SEEN} watch=labels)`,
    `// TODO(o/r#12 ${SEEN})`,
    `// TODO(o/r#13 ${SEEN})`,
    '// TODO(o/r#1)',
    '// TODO(o/r#1 seen=invalid)',
    `// TODO(o/r#404 ${SEEN})`,
    {
      code: `// TODO(o/r#1 seen=2026-09-03T00:00Z)`,
      options: [{ ignoreAuthors: ['bots', 'self'] }],
    },
    `// TODO(o/r#1 ${SEEN} watch=none)`,
    `// TODO(o/r#3 ${SEEN} watch=comments)`,
    {
      code: `// TODO(o/r#1 ${SEEN})`,
      options: [{ issues: { watch: ['state'] } }],
    },
  ],
  invalid: [
    {
      code: `// TODO(https://github.com/o/r/issues/1#issuecomment-1 ${SEEN}): remove workaround`,
      errors: [
        {
          message: lines(
            'o/r#1 "Crash on start" was updated since 2026-09-01T10:00Z: 2 new comments.',
            'First new comment by alice on 2026-09-02: "Comment 3"',
            'URL: https://github.com/o/r/issues/1#issuecomment-3',
            next(SEEN),
          ),
          line: 1,
          column: 8,
          suggestions: [
            {
              messageId: 'markSeen',
              output: `// TODO(https://github.com/o/r/issues/1#issuecomment-1 ${MARKED}): remove workaround`,
            },
            {
              desc: 'Stop watching comments on https://github.com/o/r/issues/1#issuecomment-1.',
              output: `// TODO(https://github.com/o/r/issues/1#issuecomment-1 ${SEEN} watch=state,links): remove workaround`,
            },
          ],
        },
      ],
    },
    {
      code: `// TODO(o/r#1 ${SEEN})`,
      settings: { 'todo-watch': { verbose: false } },
      errors: [{ message: 'o/r#1 "Crash on start" was updated since 2026-09-01T10:00Z: 2 new comments.' }],
    },
    {
      code: `// TODO(o/r#1 ${SEEN})`,
      options: [{ ignoreAuthors: ['bots', 'self'] }],
      errors: [{ message: /: 1 new comment\.\n {2}First new comment by alice on 2026-09-02: "Comment 3"\n/ }],
    },
    {
      code: `// TODO(o/r#1 ${SEEN})`,
      options: [{ ignoreAuthors: [] }],
      errors: [{ message: /: 3 new comments\./ }],
    },
    {
      code: `// TODO(o/r#1 ${SEEN})`,
      options: [{ ignoreAuthors: ['bots', 'Alice'] }],
      errors: [{ message: /: 1 new comment\.\n {2}First new comment by me on 2026-09-03: "Comment 4"\n/ }],
    },
    {
      code: `// TODO(o/r#11 ${SEEN})`,
      errors: [
        {
          message: lines(
            'o/r#11 "Crash on start" was updated since 2026-09-01T10:00Z: 1 new comment.',
            `First new comment by alice on 2026-09-02: "${`First line. ${'word '.repeat(60)}`.slice(0, 197).trimEnd()}..."`,
            'URL: https://github.com/o/r/issues/1#issuecomment-8',
            next(SEEN),
          ),
        },
      ],
    },
    {
      code: `// TODO(o/r#3 ${SEEN})`,
      errors: [
        {
          message: lines(
            'o/r#3 "Crash on start" was updated since 2026-09-01T10:00Z: reopened.',
            'URL: https://github.com/o/r/issues/3',
            next(SEEN),
          ),
        },
      ],
    },
    {
      code: `// TODO(o/r#3 ${SEEN})`,
      options: [{ issues: { watch: ['state', 'labels', 'milestones'] } }],
      errors: [{ message: /: reopened, labeled "bug", added to milestone "v2"\./ }],
    },
    {
      code: `// TODO(o/r#3 ${SEEN} watch=labels)`,
      errors: [
        {
          message: /: labeled "bug"\./,
          suggestions: [
            { messageId: 'markSeen', output: `// TODO(o/r#3 ${MARKED} watch=labels)` },
            { messageId: 'unwatch', output: `// TODO(o/r#3 ${SEEN} watch=none)` },
          ],
        },
      ],
    },
    {
      code: `// TODO(o/r#8 ${SEEN})`,
      options: [{ pullRequests: { watch: ['reviews'] }, issues: { watch: ['comments'] } }],
      errors: [{ message: /: approved by bob, changes requested by carol\./ }],
    },
    {
      code: `// TODO(o/r#4 ${SEEN})`,
      errors: [
        {
          message: lines(
            'o/r#4 "Crash on start" was updated since 2026-09-01T10:00Z: linked to pull request o/r#5 "Fix the crash" (open), pull request o/r#6 merged, not released yet, pull request o/r#7 closed without merge.',
            'URL: https://github.com/o/r/issues/4',
            next(SEEN),
          ),
        },
      ],
    },
    {
      code: `// TODO(o/r#8 ${SEEN})`,
      errors: [
        {
          message: lines(
            'o/r#8 "Fix crash on start" was updated since 2026-09-01T10:00Z: ready for review.',
            'URL: https://github.com/o/r/pull/8',
            next(SEEN),
          ),
          suggestions: [
            { messageId: 'markSeen', output: `// TODO(o/r#8 ${MARKED})` },
            { messageId: 'unwatch', output: `// TODO(o/r#8 ${SEEN} watch=comments)` },
          ],
        },
      ],
    },
    {
      code: `// TODO(o/r#9 ${SEEN} watch=comments,state)`,
      errors: [{ message: /^o\/r#9 "Crash on start" was updated since 2026-09-01T10:00Z: 1 new comment\.\n/ }],
    },
  ],
});
