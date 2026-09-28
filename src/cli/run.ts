import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, type CheckOptions, type CheckResult } from '../check.js';
import { MARK_SEEN_MESSAGE_ID, UNWATCH_MESSAGE_ID } from '../evaluate/activity.js';
import { Severities, type Edit } from '../evaluate/types.js';
import { formatWatch, parseWatch } from '../parse.js';
import { HELP, parseCliArgs, shouldFail, UsageError, type CliOptions } from './args.js';
import { applyEdits } from './edits.js';
import { formatReport, toProblems } from './report.js';

/**
 * Fixes can overlap, like a missing seen marker and a short reference on the same token. The
 * second one is applied in the next pass.
 */
const MAX_FIX_PASSES = 10;

export type RunDeps = {
  cwd: string;
  version: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  writeFile?: (path: string, text: string) => void;
} & Pick<CheckOptions, 'getStatuses' | 'now'>;

const toCheckOptions = (options: CliOptions, deps: RunDeps): CheckOptions => ({
  cwd: deps.cwd,
  paths: options.paths,
  rules: options.rules,
  refs: options.refs,
  keywords: options.keywords,
  repo: options.repo,
  cacheTtl: options.cacheTtl,
  format: { expandShortRefs: options.expandShortRefs },
  resolved: { waitForRelease: options.waitForRelease },
  activity: {
    ignoreAuthors: options.ignoreAuthors,
    issues: { watch: options.watchIssues },
    pullRequests: { watch: options.watchPullRequests },
  },
  getStatuses: deps.getStatuses,
  now: deps.now,
});

const WATCH_TEXT_RE = /^(\s*)watch=(\S+)$/;

/**
 * Combines the edits that stop watching single categories into one edit. They all change the same
 * marker, and each one lists the watched categories without its own, so the combined list is the
 * intersection of all lists.
 */
const combineUnwatch = (edits: Array<Edit>): Edit => {
  const [first] = edits as [Edit, ...Array<Edit>];
  const lists = edits.map((edit) => parseWatch(WATCH_TEXT_RE.exec(edit.text)?.[2] ?? '') ?? []);
  const remaining = lists.reduce((kept, list) => kept.filter((category) => list.includes(category)));
  const prefix = WATCH_TEXT_RE.exec(first.text)?.[1] ?? '';

  return { ...first, text: `${prefix}watch=${formatWatch(remaining)}` };
};

/**
 * Collects the edits for `--fix`, `--mark-seen` and `--unwatch` and writes the changed files.
 * Returns the number of applied edits.
 */
const applyChanges = (result: CheckResult, options: CliOptions, deps: RunDeps): number => {
  const writeFile = deps.writeFile ?? ((path, text) => writeFileSync(path, text));
  let applied = 0;

  for (const file of result.files) {
    const edits: Array<Edit> = [];
    for (const finding of file.findings) {
      if (options.fix && finding.fix) edits.push(finding.fix);
      for (const suggestion of finding.suggestions ?? []) {
        if (options.markSeen && suggestion.messageId === MARK_SEEN_MESSAGE_ID) edits.push(suggestion.edit);
      }

      /** Several categories change the same marker, so they are combined into one edit. */
      const unwatch = (finding.suggestions ?? []).filter(
        (suggestion) =>
          suggestion.messageId === UNWATCH_MESSAGE_ID &&
          suggestion.category &&
          options.unwatch.includes(suggestion.category),
      );
      if (unwatch.length > 0) edits.push(combineUnwatch(unwatch.map((suggestion) => suggestion.edit)));
    }
    if (edits.length === 0) continue;

    const changed = applyEdits(file.text, edits);
    if (changed.applied === 0) continue;

    writeFile(join(deps.cwd, file.path), changed.text);
    applied += changed.applied;
  }

  return applied;
};

/**
 * Runs the CLI and returns the exit code: `0` without problems at the fail level, `1` with
 * problems at the fail level, `2` for invalid arguments.
 */
export const run = async (argv: Array<string>, deps: RunDeps): Promise<number> => {
  let options: CliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    deps.stderr(`${error.message}\nRun todo-watch --help for usage.\n`);
    return 2;
  }

  if (options.help) {
    deps.stdout(HELP);
    return 0;
  }
  if (options.version) {
    deps.stdout(`${deps.version}\n`);
    return 0;
  }

  const checkOptions = toCheckOptions(options, deps);
  let result = await check(checkOptions);

  if (options.fix || options.markSeen || options.unwatch.length > 0) {
    let total = 0;
    for (let pass = 0; pass < MAX_FIX_PASSES; pass++) {
      const applied = applyChanges(result, options, deps);
      if (applied === 0) break;
      total += applied;
      result = await check(checkOptions);
    }
    deps.stderr(`Applied ${total} change${total === 1 ? '' : 's'}.\n`);
  }

  let problems = toProblems(result);
  if (options.quiet) problems = problems.filter((problem) => problem.severity === Severities.ERROR);

  deps.stdout(formatReport(problems, result.refCount, options.format, options.compact));

  return shouldFail(
    options.failOn,
    problems.map((problem) => problem.severity),
  )
    ? 1
    : 0;
};
