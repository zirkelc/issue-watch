import { evaluateInvalid, evaluateUnparsed, UNAVAILABLE_MESSAGE_ID } from './evaluate/invalid.js';
import { DEFAULT_ISSUE_OPTIONS, evaluateIssue, type IssueOptions } from './evaluate/issue.js';
import { DEFAULT_PULL_REQUEST_OPTIONS, evaluatePullRequest, type PullRequestOptions } from './evaluate/pull-request.js';
import { ALL_RULES, RuleNames, Tools, type Finding, type RuleName, type Tool } from './evaluate/types.js';
import { toRefKey, type RefId, type RefKey } from './github/types.js';
import { DEFAULT_KEYWORDS, parseTodos, type TodoEntry } from './parse.js';
import { listFiles, readSourceFile } from './service/files.js';
import { createStatusHandler, type StatusRequest, type StatusResponse } from './service/handler.js';
import { resolveRepository } from './service/repo.js';

const DEFAULT_CACHE_TTL_MINUTES = 60;

export type CheckOptions = {
  /** Directory to resolve paths and the cache against. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Files or directories to check. Defaults to the whole directory. */
  paths?: Array<string>;
  /** Rules to run. Defaults to all rules. */
  rules?: Array<RuleName>;
  /** Check only these references. */
  refs?: Array<RefId>;
  keywords?: Array<string>;
  /** The `owner/name` that `#123` references point to. Detected from git or package.json if not set. */
  repo?: string;
  /** How long a fetched status stays valid, in minutes. `0` always fetches. */
  cacheTtl?: number;
  issue?: Partial<IssueOptions>;
  pullRequest?: Partial<PullRequestOptions>;
  /** The tool whose commands the next steps name. Defaults to the CLI. */
  tool?: Tool;
  /** Loads statuses from GitHub. Defaults to a handler with cache and token lookup. */
  getStatuses?: (request: StatusRequest) => Promise<StatusResponse>;
};

export type FileReport = {
  path: string;
  text: string;
  /** Findings with offsets into `text`. */
  findings: Array<Finding>;
};

export type CheckResult = {
  files: Array<FileReport>;
  /** Number of watched references that were checked. */
  refCount: number;
};

let defaultHandler: ReturnType<typeof createStatusHandler> | undefined;

/**
 * Checks all TODO references in the given paths, with the same checks as the lint rules. Unlike
 * the lint rules, it reads any text file, not only JavaScript and TypeScript.
 */
export const check = async (options: CheckOptions = {}): Promise<CheckResult> => {
  const cwd = options.cwd ?? process.cwd();
  const rules = new Set(options.rules ?? ALL_RULES);
  const keywords = options.keywords ?? DEFAULT_KEYWORDS;
  const tool = options.tool ?? Tools.CLI;
  const only = options.refs ? new Set(options.refs.map(toRefKey)) : undefined;
  const repository = resolveRepository(cwd, options.repo);

  const issueOptions: IssueOptions = { ...DEFAULT_ISSUE_OPTIONS, ...options.issue };
  const pullRequestOptions: PullRequestOptions = { ...DEFAULT_PULL_REQUEST_OPTIONS, ...options.pullRequest };

  const files: Array<{ path: string; text: string; entries: Array<TodoEntry> }> = [];
  for (const path of listFiles(cwd, options.paths)) {
    const file = readSourceFile(cwd, path);
    if (!file) continue;

    const entries = parseTodos(file.text, keywords, repository)
      .flatMap((todo) => todo.entries)
      .filter((entry) => !only || (entry.ref && only.has(toRefKey(entry.ref))));
    if (entries.length > 0) files.push({ ...file, entries });
  }

  const refs = new Map<RefKey, RefId>();
  for (const { entries } of files) {
    for (const { ref } of entries) {
      if (ref) refs.set(toRefKey(ref), { owner: ref.owner, repo: ref.repo, number: ref.number });
    }
  }

  let statuses: StatusResponse = {};
  if (rules.size > 0 && refs.size > 0) {
    const getStatuses = options.getStatuses ?? (defaultHandler ??= createStatusHandler());
    statuses = await getStatuses({
      refs: [...refs.values()],
      cwd,
      keywords,
      cacheTtl: options.cacheTtl ?? DEFAULT_CACHE_TTL_MINUTES,
      prefetch: false,
      repo: options.repo,
    });
  }

  /** A missing token or network fails every reference, so it is reported once per run. */
  let reportedUnavailable = false;

  const reports = files.map(({ path, text, entries }): FileReport => {
    const findings: Array<Finding> = [];

    for (const entry of entries) {
      if (rules.has(RuleNames.INVALID)) findings.push(...evaluateUnparsed(entry, tool));

      const { ref } = entry;
      const result = ref ? statuses[toRefKey(ref)] : undefined;
      if (!ref || !result) continue;

      const target = { ref };
      if (rules.has(RuleNames.INVALID)) {
        for (const finding of evaluateInvalid(target, result, tool)) {
          if (finding.messageId === UNAVAILABLE_MESSAGE_ID) {
            if (reportedUnavailable) continue;
            reportedUnavailable = true;
          }
          findings.push(finding);
        }
      }
      if (rules.has(RuleNames.ISSUE)) findings.push(...evaluateIssue(target, result, issueOptions));
      if (rules.has(RuleNames.PULL_REQUEST)) {
        findings.push(...evaluatePullRequest(target, result, pullRequestOptions));
      }
    }

    return { path, text, findings };
  });

  return { files: reports, refCount: refs.size };
};
