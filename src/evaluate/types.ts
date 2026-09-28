import type { SeenMarker, Token, TodoRef } from '../parse.js';

export const RuleNames = {
  FORMAT: 'format',
  INVALID: 'invalid',
  RESOLVED: 'resolved',
  ACTIVITY: 'activity',
} as const;

export type RuleName = (typeof RuleNames)[keyof typeof RuleNames];

export const ALL_RULES: Array<RuleName> = Object.values(RuleNames);

export const Severities = {
  ERROR: 'error',
  WARN: 'warn',
} as const;

export type Severity = (typeof Severities)[keyof typeof Severities];

/**
 * Severity of each rule in the recommended config and in the CLI.
 */
export const DEFAULT_SEVERITIES: Record<RuleName, Severity> = {
  format: Severities.ERROR,
  invalid: Severities.ERROR,
  resolved: Severities.WARN,
  activity: Severities.WARN,
};

/**
 * The tool that shows a finding. The next steps name the command of that tool.
 */
export const Tools = {
  LINT: 'lint',
  CLI: 'cli',
} as const;

export type Tool = (typeof Tools)[keyof typeof Tools];

/**
 * Replaces the text between two offsets. The offsets use the same base as the parsed tokens.
 */
export type Edit = {
  start: number;
  end: number;
  text: string;
};

export type Finding = {
  rule: RuleName;
  messageId: string;
  /** The first line of the message: the target and what changed. */
  summary: string;
  /** Lines with context, the URL and the next step. */
  details: Array<string>;
  /** The token the finding points to. */
  token: Token;
  /** The reference the finding is about, if it has one. */
  ref: TodoRef | undefined;
  /** A safe change that `--fix` applies. */
  fix?: Edit;
  /** A change that needs a decision, like marking activity as seen. */
  suggestion?: {
    messageId: string;
    description: string;
    edit: Edit;
  };
};

/**
 * A reference with its optional seen marker, as parsed from one TODO entry.
 */
export type RefTarget = {
  ref: TodoRef;
  seen: SeenMarker | undefined;
};

const DETAIL_SEPARATOR = '\n  ';

/**
 * Builds the full message text. Without `verbose`, only the first line is kept.
 */
export const formatMessage = (finding: Pick<Finding, 'summary' | 'details'>, verbose: boolean): string =>
  verbose ? [finding.summary, ...finding.details].join(DETAIL_SEPARATOR) : finding.summary;

export const editOf = (token: Token, text: string): Edit => ({ start: token.start, end: token.end, text });
