import { RefKinds, toRefUrl, type TodoEntry } from '../parse.js';
import { fixCommand } from './messages.js';
import { editOf, RuleNames, Tools, type Finding, type Tool } from './types.js';

export type FormatOptions = {
  /** Replace `owner/repo#123` and `#123` with the full URL, so the reference is clickable in the editor. */
  expandShortRefs: boolean;
};

/**
 * An entry is watched if it has a reference, a `#123` reference, or at least mentions GitHub.
 * Other entries like `TODO(username)` follow a different convention and are ignored.
 */
export const isWatched = (entry: TodoEntry): boolean =>
  entry.ref !== undefined ||
  entry.unresolved !== undefined ||
  entry.unknown.some((token) => token.text.includes('github.com'));

const repoSetting = (tool: Tool) =>
  tool === Tools.CLI ? 'run todo-watch with --repo owner/name' : 'set settings["todo-watch"].repo to "owner/name"';

/**
 * Checks the syntax of one TODO entry. This needs no network access.
 */
export const evaluateFormat = (entry: TodoEntry, options: FormatOptions, tool: Tool): Array<Finding> => {
  if (!isWatched(entry)) return [];

  const findings: Array<Finding> = [];
  const base: Pick<Finding, 'rule' | 'details' | 'ref'> = { rule: RuleNames.FORMAT, details: [], ref: entry.ref };

  const { ref, unresolved } = entry;
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
      summary: `Unexpected text "${token.text}" in the TODO reference. Put other text after the closing parenthesis, like TODO(owner/repo#123): text.`,
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
