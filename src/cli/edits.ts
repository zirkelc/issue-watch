import type { Edit } from '../evaluate/types.js';

/**
 * Applies edits from the end of the text to the start, so earlier offsets stay valid. An edit
 * that overlaps an already applied edit is skipped, and the next pass can apply it.
 */
export const applyEdits = (text: string, edits: Array<Edit>): { text: string; applied: number } => {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);

  let result = text;
  let applied = 0;
  let limit = Number.POSITIVE_INFINITY;

  for (const edit of sorted) {
    if (edit.end > limit) continue;
    result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`;
    limit = edit.start;
    applied++;
  }

  return { text: result, applied };
};
