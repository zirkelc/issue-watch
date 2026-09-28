import { formatRef } from '../github/types.js';
import { DEFAULT_SEVERITIES, Severities, type Finding, type Severity } from '../evaluate/types.js';
import type { CheckResult } from '../check.js';

export const OutputFormats = {
  TEXT: 'text',
  JSON: 'json',
  MARKDOWN: 'markdown',
} as const;

export type OutputFormat = (typeof OutputFormats)[keyof typeof OutputFormats];

/**
 * A finding with its file, 1-based position and severity, ready to print.
 */
export type Problem = {
  file: string;
  line: number;
  column: number;
  severity: Severity;
  rule: Finding['rule'];
  messageId: string;
  ref: string | undefined;
  summary: string;
  details: Array<string>;
  fixable: boolean;
  suggestions: Array<string>;
};

const lineStarts = (text: string) => {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\n') starts.push(index + 1);
  }
  return starts;
};

const positionOf = (starts: Array<number>, offset: number) => {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: offset - starts[low]! + 1 };
};

export const toProblems = (result: CheckResult): Array<Problem> =>
  result.files.flatMap((file) => {
    const starts = lineStarts(file.text);
    return file.findings.map((finding) => ({
      file: file.path,
      ...positionOf(starts, finding.token.start),
      severity: DEFAULT_SEVERITIES[finding.rule],
      rule: finding.rule,
      messageId: finding.messageId,
      ref: finding.ref ? formatRef(finding.ref) : undefined,
      summary: finding.summary,
      details: finding.details,
      fixable: finding.fix !== undefined,
      suggestions: (finding.suggestions ?? []).map((suggestion) => suggestion.description),
    }));
  });

const countBy = (problems: Array<Problem>, severity: Severity) =>
  problems.filter((problem) => problem.severity === severity).length;

/** People read "warning". The JSON output keeps `warn`, like lint configs. */
const SEVERITY_LABELS: Record<Severity, string> = { error: 'error', warn: 'warning' };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const formatText = (problems: Array<Problem>, refCount: number, compact: boolean): string => {
  if (problems.length === 0) return `No problems found in ${plural(refCount, 'reference')}.\n`;

  const blocks = problems.map((problem) => {
    const header = `${problem.file}:${problem.line}:${problem.column}  ${SEVERITY_LABELS[problem.severity]}  ${problem.rule}`;
    if (compact) return `${header}  ${problem.summary}`;
    return [header, ...[problem.summary, ...problem.details].map((line) => `  ${line}`)].join('\n');
  });

  const errors = countBy(problems, Severities.ERROR);
  const warnings = countBy(problems, Severities.WARN);
  const fixable = problems.filter((problem) => problem.fixable).length;
  const footer = [
    `${plural(problems.length, 'problem')} (${plural(errors, 'error')}, ${plural(warnings, 'warning')}) in ${plural(refCount, 'reference')}.`,
    fixable > 0 ? `${fixable} can be fixed with --fix.` : undefined,
  ]
    .filter(Boolean)
    .join(' ');

  return `${blocks.join(compact ? '\n' : '\n\n')}\n\n${footer}\n`;
};

const formatJson = (problems: Array<Problem>, refCount: number): string =>
  `${JSON.stringify(
    {
      problems,
      errorCount: countBy(problems, Severities.ERROR),
      warningCount: countBy(problems, Severities.WARN),
      refCount,
    },
    null,
    2,
  )}\n`;

const formatMarkdown = (problems: Array<Problem>, refCount: number, compact: boolean): string => {
  const lines = ['## todo-watch', ''];
  if (problems.length === 0) {
    lines.push(`No problems found in ${plural(refCount, 'reference')}.`);
    return `${lines.join('\n')}\n`;
  }

  const files = [...new Set(problems.map((problem) => problem.file))];
  for (const file of files) {
    lines.push(`### \`${file}\``, '');
    for (const problem of problems.filter((candidate) => candidate.file === file)) {
      lines.push(
        `- **${SEVERITY_LABELS[problem.severity]}** \`${problem.rule}\` [line ${problem.line}](${file}#L${problem.line}): ${problem.summary}`,
      );
      if (!compact) for (const detail of problem.details) lines.push(`  - ${detail}`);
    }
    lines.push('');
  }

  lines.push(
    `${plural(problems.length, 'problem')} (${plural(countBy(problems, Severities.ERROR), 'error')}, ${plural(countBy(problems, Severities.WARN), 'warning')}) in ${plural(refCount, 'reference')}.`,
  );
  return `${lines.join('\n')}\n`;
};

export const formatReport = (
  problems: Array<Problem>,
  refCount: number,
  format: OutputFormat,
  compact: boolean,
): string => {
  if (format === OutputFormats.JSON) return formatJson(problems, refCount);
  if (format === OutputFormats.MARKDOWN) return formatMarkdown(problems, refCount, compact);
  return formatText(problems, refCount, compact);
};
