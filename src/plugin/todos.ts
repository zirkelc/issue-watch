import type { Context } from '@oxlint/plugins';
import {
  parseTodos,
  type Repository,
  type SeenMarker,
  type TodoEntry,
  type TodoRef,
  type WatchMarker,
} from '../parse.js';

/**
 * Length of the comment opener (`//` or `/*`) that is not part of the comment value.
 */
const COMMENT_OPENER_LENGTH = 2;

export type Location = {
  start: { line: number; column: number };
  end: { line: number; column: number };
};

/**
 * Offsets inside a comment value, like a token or an edit.
 */
export type Span = {
  start: number;
  end: number;
};

export type EntryInFile = {
  entry: TodoEntry;
  locOf: (span: Span) => Location;
  rangeOf: (span: Span) => [number, number];
};

export type RefInFile = EntryInFile & {
  ref: TodoRef;
  seen: SeenMarker | undefined;
  watch: WatchMarker | undefined;
};

/**
 * Finds all TODO entries in the comments of the current file, with helpers that convert the
 * offsets inside a comment to source ranges and locations.
 */
export const findEntries = (
  context: Context,
  keywords: Array<string>,
  repository: Repository | undefined,
): Array<EntryInFile> => {
  const { sourceCode } = context;
  const entries: Array<EntryInFile> = [];

  for (const comment of sourceCode.getAllComments()) {
    if (comment.type === 'Shebang') continue;

    const base = comment.range[0] + COMMENT_OPENER_LENGTH;
    const rangeOf = (span: Span): [number, number] => [base + span.start, base + span.end];
    const locOf = (span: Span): Location => ({
      start: sourceCode.getLocFromIndex(base + span.start),
      end: sourceCode.getLocFromIndex(base + span.end),
    });

    for (const todo of parseTodos(comment.value, keywords, repository)) {
      for (const entry of todo.entries) entries.push({ entry, locOf, rangeOf });
    }
  }

  return entries;
};

/**
 * Finds all entries with a valid reference. Entries without reference are left to the format rule.
 */
export const findRefs = (
  context: Context,
  keywords: Array<string>,
  repository: Repository | undefined,
): Array<RefInFile> =>
  findEntries(context, keywords, repository).flatMap((found) =>
    found.entry.ref ? [{ ...found, ref: found.entry.ref, seen: found.entry.seen, watch: found.entry.watch }] : [],
  );
