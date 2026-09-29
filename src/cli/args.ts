import { parseArgs } from 'node:util';
import { REPORTED_ISSUE_STATES, type ReportedIssueState } from '../evaluate/issue.js';
import { REPORTED_PULL_REQUEST_STATES, type ReportedPullRequestState } from '../evaluate/pull-request.js';
import { ALL_RULES, Severities, type RuleName, type Severity } from '../evaluate/types.js';
import type { RefId } from '../github/types.js';
import { DEFAULT_KEYWORDS, parseRef } from '../parse.js';
import { parseRepository } from '../service/repo.js';
import { OutputFormats, type OutputFormat } from './report.js';

export const FailLevels = {
  ...Severities,
  NONE: 'none',
} as const;

export type FailLevel = (typeof FailLevels)[keyof typeof FailLevels];

export type CliOptions = {
  paths: Array<string>;
  format: OutputFormat;
  rules: Array<RuleName>;
  failOn: FailLevel;
  refs: Array<RefId> | undefined;
  fix: boolean;
  keywords: Array<string>;
  repo: string | undefined;
  issueStates: Array<ReportedIssueState>;
  pullRequestStates: Array<ReportedPullRequestState>;
  linkedPullRequests: boolean;
  waitForRelease: boolean;
  cacheTtl: number;
  quiet: boolean;
  compact: boolean;
  help: boolean;
  version: boolean;
};

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const HELP = `Usage: todo-watch [options] [paths...]

Checks the GitHub issues and pull requests linked in TODO(...) comments.
Paths default to the current directory. In a git repository, only tracked
and not ignored files are checked.

Output:
  --format <format>          text, json or markdown (default: text)
  --quiet                    Report errors only
  --compact                  Print only the first line of each message
  --fail-on <level>          Exit with 1 on error, warn or none (default: error)

Selection:
  --rules <list>             Rules to run (default: ${ALL_RULES.join(',')})
  --ref <owner/repo#123>     Check only this reference. Can be repeated
  --keywords <list>          Comment keywords (default: ${DEFAULT_KEYWORDS.join(',')})
  --repo <owner/name>        Repository of #123 references (default: git remote
                             upstream, then origin, then package.json)

Changes:
  --fix                      Update moved references

Checks:
  --issue-states <list>      Issue states to report (default: ${REPORTED_ISSUE_STATES.join(',')})
  --pr-states <list>         Pull request states to report (default: ${REPORTED_PULL_REQUEST_STATES.join(',')})
  --no-linked-prs            Do not report open issues with a merged linked pull request
  --wait-for-release         Report a fix only when a release contains it

Cache:
  --cache-ttl <minutes>      How long fetched statuses stay valid (default: 60)
  --no-cache                 Fetch all statuses again

  -h, --help                 Show this help
  -v, --version              Show the version

A GitHub token is read from GITHUB_TOKEN or GH_TOKEN, or from \`gh auth token\`.
`;

const list = (value: string | undefined) =>
  value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const oneOf = <VALUE extends string>(name: string, value: string, allowed: ReadonlyArray<VALUE>): VALUE => {
  if (!allowed.includes(value as VALUE)) {
    throw new UsageError(`Invalid value "${value}" for --${name}. Use one of: ${allowed.join(', ')}.`);
  }
  return value as VALUE;
};

export const parseCliArgs = (argv: Array<string>): CliOptions => {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        format: { type: 'string', default: OutputFormats.TEXT },
        rules: { type: 'string' },
        'fail-on': { type: 'string', default: FailLevels.ERROR },
        ref: { type: 'string', multiple: true },
        fix: { type: 'boolean', default: false },
        keywords: { type: 'string' },
        repo: { type: 'string' },
        'issue-states': { type: 'string' },
        'pr-states': { type: 'string' },
        'no-linked-prs': { type: 'boolean', default: false },
        'wait-for-release': { type: 'boolean', default: false },
        'cache-ttl': { type: 'string' },
        'no-cache': { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        compact: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }

  const { values, positionals } = parsed;

  const refs = values.ref?.map((text) => {
    const ref = parseRef({ text, start: 0, end: text.length });
    if (!ref) throw new UsageError(`Invalid reference "${text}". Use owner/repo#123 or a GitHub URL.`);
    return { owner: ref.owner, repo: ref.repo, number: ref.number };
  });

  let cacheTtl = 60;
  if (values['cache-ttl'] !== undefined) {
    cacheTtl = Number(values['cache-ttl']);
    if (!Number.isFinite(cacheTtl) || cacheTtl < 0) {
      throw new UsageError(`Invalid value "${values['cache-ttl']}" for --cache-ttl. Use a number of minutes.`);
    }
  }
  if (values['no-cache']) cacheTtl = 0;

  if (values.repo !== undefined && !parseRepository(values.repo)) {
    throw new UsageError(`Invalid value "${values.repo}" for --repo. Use owner/name.`);
  }

  return {
    paths: positionals.length > 0 ? positionals : ['.'],
    format: oneOf('format', values.format, Object.values(OutputFormats)),
    rules: (list(values.rules) ?? ALL_RULES).map((rule) => oneOf('rules', rule, ALL_RULES)),
    failOn: oneOf('fail-on', values['fail-on'], Object.values(FailLevels)),
    refs,
    fix: values.fix,
    keywords: list(values.keywords) ?? DEFAULT_KEYWORDS,
    repo: values.repo,
    issueStates: (list(values['issue-states']) ?? REPORTED_ISSUE_STATES).map((state) =>
      oneOf('issue-states', state, REPORTED_ISSUE_STATES),
    ),
    pullRequestStates: (list(values['pr-states']) ?? REPORTED_PULL_REQUEST_STATES).map((state) =>
      oneOf('pr-states', state, REPORTED_PULL_REQUEST_STATES),
    ),
    linkedPullRequests: !values['no-linked-prs'],
    waitForRelease: values['wait-for-release'],
    cacheTtl,
    quiet: values.quiet,
    compact: values.compact,
    help: values.help,
    version: values.version,
  };
};

export const shouldFail = (failOn: FailLevel, severities: Array<Severity>): boolean => {
  if (failOn === FailLevels.NONE) return false;
  if (failOn === FailLevels.WARN) return severities.length > 0;
  return severities.includes(Severities.ERROR);
};
