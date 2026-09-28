import { RuleTester } from 'oxlint/plugins-dev';
import { createInvalidRule } from '../src/plugin/rules.js';
import { FETCHED_AT, fakeProvider, issue, ok, setupRuleTester } from './fixtures.js';

setupRuleTester(RuleTester);

/** Joins the first line of a message with its indented detail lines. */
const lines = (...parts: Array<string>) => parts.join('\n  ');

const NEXT_UNAVAILABLE =
  'Next: set GITHUB_TOKEN or GH_TOKEN, or run `gh auth login`. If the network is down, try again later.';

const provider = fakeProvider({
  'o/r#1': ok(issue()),
  'o/r#404': { ok: false, reason: 'not-found', message: 'not found', fetchedAt: FETCHED_AT },
  'old/name#1': ok(issue({ owner: 'new', repo: 'name', url: 'https://github.com/new/name/issues/1' })),
  'o/r#7': ok(issue({ owner: 'other', repo: 'repo', number: 3, url: 'https://github.com/other/repo/issues/3' })),
  'x/y#1': { ok: false, reason: 'unavailable', message: 'No GitHub token found.', fetchedAt: FETCHED_AT },
  'x/y#2': { ok: false, reason: 'unavailable', message: 'No GitHub token found.', fetchedAt: FETCHED_AT },
});

const throwingProvider = () => {
  throw new Error('worker timed out');
};

const tester = new RuleTester();

tester.run('invalid', createInvalidRule(provider), {
  valid: [
    `// TODO(o/r#1)`,
    `// TODO(https://github.com/O/R/issues/1)`,
    {
      code: `// TODO(x/y#1)`,
      options: [{ reportUnavailable: false }],
    },
  ],
  invalid: [
    {
      code: `// TODO(o/r#404)`,
      errors: [
        {
          message: lines(
            'o/r#404 was not found, or the GitHub token has no access to it.',
            'Next: check the reference for typos. If the issue was deleted, remove the comment. If the repo is private, check that the GitHub token can read it.',
          ),
          column: 8,
          endColumn: 15,
        },
      ],
    },
    {
      code: `// TODO(old/name#1)`,
      output: `// TODO(new/name#1)`,
      errors: [
        {
          message: lines(
            'old/name#1 has moved to new/name#1 "Crash on start".',
            'URL: https://github.com/new/name/issues/1',
            'Next: run the linter with --fix, or replace "old/name#1" with "new/name#1".',
          ),
        },
      ],
    },
    {
      code: `// TODO(https://github.com/old/name/issues/1#issuecomment-5)`,
      output: `// TODO(https://github.com/new/name/issues/1#issuecomment-5)`,
      errors: [{ messageId: 'moved' }],
    },
    {
      code: `// TODO(https://github.com/o/r/issues/7)`,
      output: `// TODO(https://github.com/other/repo/issues/3)`,
      errors: [{ message: /^https:\/\/github\.com\/o\/r\/issues\/7 has moved to other\/repo#3 "Crash on start"\./ }],
    },
    {
      code: `// TODO(x/y#1)\n// TODO(x/y#2)`,
      errors: [
        { message: lines('Could not check the status of x/y#1: No GitHub token found.', NEXT_UNAVAILABLE), line: 1 },
      ],
    },
  ],
});

tester.run('invalid with failing provider', createInvalidRule(throwingProvider), {
  valid: ['// TODO: nothing to check'],
  invalid: [
    {
      code: `// TODO(o/r#1)`,
      settings: { 'todo-watch': { verbose: false } },
      errors: [{ message: 'Could not check the status of o/r#1: worker timed out' }],
    },
  ],
});
