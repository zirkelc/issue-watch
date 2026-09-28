import { RuleTester } from 'oxlint/plugins-dev';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import { formatRule } from '../src/plugin/rules.js';

RuleTester.describe = describe;
RuleTester.it = it;

const NOW = '2026-09-28T08:51:30.000Z';
const SEEN = 'seen=2026-09-28T08:51Z';

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterAll(() => {
  vi.useRealTimers();
});

const tester = new RuleTester();

tester.run('format', formatRule, {
  valid: [
    `// TODO(https://github.com/o/r/issues/1 ${SEEN})`,
    `// TODO(https://github.com/o/r/pull/2#issuecomment-99 ${SEEN}): remove workaround`,
    `// FIXME(o/r#1 ${SEEN}, o/r#2 ${SEEN})`,
    `/** TODO(o/r#1 ${SEEN}) */`,
    `/*\n * TODO(\n *   o/r#1 ${SEEN}\n * )\n */`,
    '// TODO: plain todo',
    '// TODO(zirkelc): not a reference',
    '// see https://github.com/o/r/issues/1',
    '// todo(o/r#1)',
    {
      code: '// HACK(o/r#1)',
      settings: { 'todo-watch': { keywords: ['TODO'] } },
    },
    {
      code: `// TODO(o/r#1 ${SEEN})`,
      options: [{ expandShortRefs: false }],
    },
  ],
  invalid: [
    {
      code: '// TODO(https://github.com/o/r/issues/1)',
      output: `// TODO(https://github.com/o/r/issues/1 ${SEEN})`,
      errors: [{ messageId: 'missingSeen', line: 1, column: 8, endColumn: 39 }],
    },
    {
      code: '// TODO(https://github.com/o/r/issues/1#issuecomment-99): remove',
      output: `// TODO(https://github.com/o/r/issues/1#issuecomment-99 ${SEEN}): remove`,
      errors: [{ messageId: 'missingSeen' }],
    },
    {
      code: `// TODO(o/r#1 ${SEEN}, o/r#2)`,
      output: `// TODO(o/r#1 ${SEEN}, o/r#2 ${SEEN})`,
      errors: [
        {
          message:
            'Missing seen marker for "o/r#2". Add " seen=2026-09-28T08:51Z" after the reference, or run the linter with --fix.',
        },
      ],
    },
    {
      code: '/* HACK(o/r#1) */',
      output: `/* HACK(o/r#1 ${SEEN}) */`,
      settings: { 'todo-watch': { keywords: ['HACK'] } },
      errors: [{ messageId: 'missingSeen' }],
    },
    {
      code: `// TODO(https://github.com/o/r/issue/1 ${SEEN})`,
      output: null,
      errors: [{ message: /^"https:\/\/github\.com\/o\/r\/issue\/1" is not a GitHub issue/ }],
    },
    {
      code: `// TODO(zirkelc ${SEEN})`,
      output: null,
      errors: [{ message: /^"zirkelc seen=2026-09-28T08:51Z" is not a GitHub issue/ }],
    },
    {
      code: `// TODO(o/r#1 ${SEEN} please)`,
      output: null,
      errors: [{ message: /^Unexpected text "please"/, column: 37, endColumn: 43 }],
    },
    {
      code: '// TODO(o/r#1 seen=2026-09-28)',
      output: null,
      errors: [
        {
          message:
            'Invalid seen marker "seen=2026-09-28". Use seen=YYYY-MM-DDTHH:MMZ in UTC, like seen=2026-09-28T08:51Z.',
        },
      ],
    },
    {
      code: '// TODO(o/r#1 seen=2026-02-30T10:00Z)',
      output: null,
      errors: [{ messageId: 'invalidSeen' }],
    },
    {
      code: '// TODO(o/r#1 seen=2026-09-28T08:52Z)',
      output: null,
      errors: [{ messageId: 'futureSeen' }],
    },
    {
      code: `// TODO(o/r#1 ${SEEN})`,
      output: `// TODO(https://github.com/o/r/issues/1 ${SEEN})`,
      options: [{ expandShortRefs: true }],
      errors: [
        {
          message:
            'Use the full URL for "o/r#1" to make it clickable: https://github.com/o/r/issues/1. Run the linter with --fix to replace it.',
        },
      ],
    },
    {
      code: '// TODO(o/r#1)',
      output: `// TODO(https://github.com/o/r/issues/1 ${SEEN})`,
      options: [{ expandShortRefs: true }],
      /** Both fixes touch the ref, so the second one is applied in the next pass. */
      recursive: 1,
      errors: [{ messageId: 'missingSeen' }, { messageId: 'shortRef' }],
    },
  ],
});
