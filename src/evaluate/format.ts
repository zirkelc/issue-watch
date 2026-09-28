import {
  formatSeen,
  RefKinds,
  toRefUrl,
  WATCH_CATEGORIES,
  WATCH_NONE,
  type TodoEntry,
  type TodoRef,
} from '../parse.js';
import { fixCommand } from './messages.js';
import { editOf, RuleNames, Tools, type Finding, type Tool } from './types.js';

export type FormatOptions = {
  /** Replace `owner/repo#123` and `#123` with the full URL, so the reference is clickable in the editor. */
  expandShortRefs: boolean;
};

export type FormatContext = {
  now: Date;
  tool: Tool;
  /** Finds when a reference was added, e.g. from git history. */
  addedAt?: (ref: TodoRef) => Date | undefined;
};

/**
 * An entry is watched if it has a reference, a marker, a `#123` reference, or at least mentions
 * GitHub. Other entries like `TODO(username)` follow a different convention and are ignored.
 */
export const isWatched = (entry: TodoEntry): boolean =>
  entry.ref !== undefined ||
  entry.seen !== undefined ||
  entry.watch !== undefined ||
  entry.unresolved !== undefined ||
  entry.unknown.some((token) => token.text.includes('github.com'));

const repoSetting = (tool: Tool) =>
  tool === Tools.CLI ? 'run todo-watch with --repo owner/name' : 'set settings["todo-watch"].repo to "owner/name"';

/**
 * Checks the syntax of one TODO entry. This needs no network access.
 */
export const evaluateFormat = (entry: TodoEntry, options: FormatOptions, context: FormatContext): Array<Finding> => {
  if (!isWatched(entry)) return [];

  const { now, tool } = context;
  const findings: Array<Finding> = [];
  const nowValue = formatSeen(now);
  const base: Pick<Finding, 'rule' | 'details' | 'ref'> = { rule: RuleNames.FORMAT, details: [], ref: entry.ref };

  const { ref, seen, watch, unresolved } = entry;
  if (!ref) {
    if (unresolved) {
      findings.push({
        ...base,
        messageId: 'missingRepo',
        token: unresolved,
        summary: `"${unresolved.text}" needs the repository of the project, but none was found. Add a GitHub remote named upstream or origin, set "repository" in package.json, or ${repoSetting(tool)}.`,
      });
      return findings;
    }

    const token = entry.unknown.find((unknown) => unknown.text.includes('github.com')) ?? entry;
    findings.push({
      ...base,
      messageId: 'invalidRef',
      token,
      summary: `"${token.text}" is not a GitHub issue or pull request reference. Use a URL like https://github.com/owner/repo/issues/123, the short form owner/repo#123, or #123 in the repository of the project.`,
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
    const addedAt = context.addedAt?.(ref);
    const initial = addedAt && addedAt < now ? addedAt : now;
    const value = formatSeen(initial);
    const origin = initial === now ? 'the current time' : 'the time the reference was added in git';
    findings.push({
      ...base,
      messageId: 'missingSeen',
      token: ref,
      summary: `Missing seen marker for "${ref.text}". Add " seen=${value}" (${origin}) after the reference, or ${fixCommand(tool)}.`,
      fix: { start: ref.end, end: ref.end, text: ` seen=${value}` },
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

  if (watch && !watch.categories) {
    findings.push({
      ...base,
      messageId: 'invalidWatch',
      token: watch,
      summary: `Invalid watch marker "${watch.text}". Use a list without spaces of ${WATCH_CATEGORIES.join(', ')}, like watch=comments,links, or watch=${WATCH_NONE}.`,
    });
  }

  if (options.expandShortRefs && ref.kind !== RefKinds.URL) {
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
