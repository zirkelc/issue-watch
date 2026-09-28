import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, type CheckOptions, type CheckResult } from '../check.js';
import { MARK_SEEN_MESSAGE_ID } from '../evaluate/activity.js';
import { Severities, type Edit } from '../evaluate/types.js';
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
  cacheTtl: options.cacheTtl,
  format: { expandShortRefs: options.expandShortRefs },
  resolved: { waitForRelease: options.waitForRelease },
  activity: { ignoreAuthors: options.ignoreAuthors, include: options.include },
  getStatuses: deps.getStatuses,
  now: deps.now,
});

/**
 * Collects the edits for `--fix` and `--mark-seen` and writes the changed files. Returns the
 * number of applied edits.
 */
const applyChanges = (result: CheckResult, options: CliOptions, deps: RunDeps): number => {
  const writeFile = deps.writeFile ?? ((path, text) => writeFileSync(path, text));
  let applied = 0;

  for (const file of result.files) {
    const edits: Array<Edit> = [];
    for (const finding of file.findings) {
      if (options.fix && finding.fix) edits.push(finding.fix);
      if (options.markSeen && finding.suggestion?.messageId === MARK_SEEN_MESSAGE_ID) {
        edits.push(finding.suggestion.edit);
      }
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

  if (options.fix || options.markSeen) {
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
