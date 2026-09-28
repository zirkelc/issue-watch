import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';
import { formatRule } from '../src/plugin/rules.js';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run('format', formatRule, {
  valid: [
    '// TODO(https://github.com/o/r/issues/1)',
    '// TODO(https://github.com/o/r/pull/2#issuecomment-99): use the new option',
    '// TODO(o/r#1, o/r#2)',
    /** FIXME is not a keyword by default. */
    '// FIXME(zirkelc https://github.com/o)',
    '/** TODO(o/r#1) */',
    '/*\n * TODO(\n *   o/r#1\n * )\n */',
    '// TODO: plain todo',
    '// TODO(zirkelc): not a reference',
    '// see https://github.com/o/r/issues/1',
    '// todo(o/r#1)',
    {
      code: '// HACK(o/r#1)',
      settings: { 'todo-watch': { keywords: ['TODO'] } },
    },
    {
      code: '/* HACK(o/r#1) */',
      settings: { 'todo-watch': { keywords: ['HACK'] } },
    },
    {
      code: '// TODO(#12)',
      settings: { 'todo-watch': { repo: 'vitest-dev/vitest' } },
    },
    {
      code: '// TODO(o/r#1)',
      options: [{ expandShortRefs: false }],
    },
  ],
  invalid: [
    {
      code: '// TODO(#12)',
      settings: { 'todo-watch': { repo: 'not a repo!' } },
      errors: [
        {
          message:
            '"#12" needs the repository of the project, but none was found. Add a GitHub remote named upstream or origin, set "repository" in package.json, or set settings["todo-watch"].repo to "owner/name".',
        },
      ],
    },
    {
      code: '// TODO(#12)',
      output: '// TODO(https://github.com/vitest-dev/vitest/issues/12)',
      options: [{ expandShortRefs: true }],
      settings: { 'todo-watch': { repo: 'vitest-dev/vitest' } },
      errors: [{ messageId: 'shortRef' }],
    },
    {
      code: '// TODO(https://github.com/o/r/issue/1)',
      output: null,
      errors: [{ message: /^"https:\/\/github\.com\/o\/r\/issue\/1" is not a GitHub issue/ }],
    },
    {
      code: '// TODO(zirkelc https://github.com/o)',
      output: null,
      errors: [{ message: /^"https:\/\/github\.com\/o" is not a GitHub issue/ }],
    },
    {
      code: '// TODO(o/r#1 please)',
      output: null,
      errors: [
        {
          message:
            'Unexpected text "please" in the TODO reference. Put other text after the closing parenthesis, like TODO(owner/repo#123): text.',
          column: 14,
          endColumn: 20,
        },
      ],
    },
    {
      code: '// TODO(o/r#1)',
      output: '// TODO(https://github.com/o/r/issues/1)',
      options: [{ expandShortRefs: true }],
      errors: [
        {
          message:
            'Use the full URL for "o/r#1" to make it clickable: https://github.com/o/r/issues/1. Run the linter with --fix to replace it.',
          line: 1,
          column: 8,
          endColumn: 13,
        },
      ],
    },
  ],
});
