import { formatSeen, RefKinds, toRefUrl, type TodoEntry } from '../parse.js';
import { fixCommand } from './messages.js';
import { editOf, RuleNames, type Finding, type Tool } from './types.js';

export type FormatOptions = {
  /** Replace `owner/repo#123` with the full URL, so the reference is clickable in the editor. */
  expandShortRefs: boolean;
};

/**
 * An entry is watched if it has a reference, a seen marker or at least mentions GitHub.
 * Other entries like `TODO(username)` follow a different convention and are ignored.
 */
export const isWatched = (entry: TodoEntry): boolean =>
  entry.ref !== undefined ||
  entry.seen !== undefined ||
  entry.unknown.some((token) => token.text.includes('github.com'));

/**
 * Checks the syntax of one TODO entry. This needs no network access.
 */
export const evaluateFormat = (entry: TodoEntry, options: FormatOptions, now: Date, tool: Tool): Array<Finding> => {
  if (!isWatched(entry)) return [];

  const findings: Array<Finding> = [];
  const nowValue = formatSeen(now);
  const base: Pick<Finding, 'rule' | 'details' | 'ref'> = { rule: RuleNames.FORMAT, details: [], ref: entry.ref };

  const { ref, seen } = entry;
  if (!ref) {
    const token = entry.unknown.find((unknown) => unknown.text.includes('github.com')) ?? entry;
    findings.push({
      ...base,
      messageId: 'invalidRef',
      token,
      summary: `"${token.text}" is not a GitHub issue or pull request reference. Use a URL like https://github.com/owner/repo/issues/123 or the short form owner/repo#123.`,
    });
    return findings;
  }

  for (const token of entry.unknown) {
    findings.push({
      ...base,
      messageId: 'unexpectedText',
      token,
      summary: `Unexpected text "${token.text}" in the TODO reference. Put other text after the closing parenthesis, like TODO(owner/repo#123 seen=...): text.`,
    });
  }

  if (!seen) {
    findings.push({
      ...base,
      messageId: 'missingSeen',
      token: ref,
      summary: `Missing seen marker for "${ref.text}". Add " seen=${nowValue}" after the reference, or ${fixCommand(tool)}.`,
      fix: { start: ref.end, end: ref.end, text: ` seen=${nowValue}` },
    });
  } else if (!seen.date) {
    findings.push({
      ...base,
      messageId: 'invalidSeen',
      token: seen,
      summary: `Invalid seen marker "${seen.text}". Use seen=YYYY-MM-DDTHH:MMZ in UTC, like seen=${nowValue}.`,
    });
  } else if (seen.date > now) {
    findings.push({
      ...base,
      messageId: 'futureSeen',
      token: seen,
      summary: `The seen marker "${seen.text}" is in the future. Use the current time in UTC, like seen=${nowValue}.`,
    });
  }

  if (options.expandShortRefs && ref.kind === RefKinds.SHORT) {
    const url = toRefUrl(ref);
    findings.push({
      ...base,
      messageId: 'shortRef',
      token: ref,
      summary: `Use the full URL for "${ref.text}" to make it clickable: ${url}. ${capitalize(fixCommand(tool))} to replace it.`,
      fix: editOf(ref, url),
    });
  }

  return findings;
};

const capitalize = (text: string) => `${text[0]!.toUpperCase()}${text.slice(1)}`;
