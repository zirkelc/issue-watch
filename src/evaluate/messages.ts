import { formatRef, ReleaseStates, type RefId, type Release } from '../github/types.js';
import { Tools, type Tool } from './types.js';

const EXCERPT_LENGTH = 200;

/**
 * Names a reference with its title, e.g. `vitest-dev/vitest#123 "Coverage is wrong"`.
 */
export const describeTarget = (ref: RefId & { title?: string }): string =>
  ref.title ? `${formatRef(ref)} "${ref.title}"` : formatRef(ref);

/**
 * Shortens a comment to one line, so it fits into a message.
 */
export const excerpt = (text: string, length: number = EXCERPT_LENGTH): string => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > length ? `${line.slice(0, length - 3).trimEnd()}...` : line;
};

export const formatDate = (iso: string | undefined): string => iso?.slice(0, 10) ?? 'an unknown date';

/**
 * Describes a release as a suffix for a sentence, e.g. `, released in v1.2.3`.
 */
export const describeRelease = (release: Release | undefined): string => {
  if (release?.state === ReleaseStates.RELEASED) {
    return release.exact ? `, released in ${release.tag}` : `, released in ${release.tag} or earlier`;
  }
  if (release?.state === ReleaseStates.UNRELEASED) return ', not released yet';
  return '';
};

/**
 * Names the command that applies the safe fixes in the tool that shows the finding.
 */
export const fixCommand = (tool: Tool): string =>
  tool === Tools.CLI ? 'run `issue-watch --fix`' : 'run the linter with --fix';

/**
 * The next step after a fix was merged, depending on its release.
 */
export const nextStepForFix = (release: Release | undefined): string => {
  if (release?.state === ReleaseStates.RELEASED) {
    return `Next: upgrade to ${release.tag} or later, then remove the comment.`;
  }
  if (release?.state === ReleaseStates.UNRELEASED) {
    return 'Next: keep the comment until a release contains the fix, then upgrade and remove the comment.';
  }
  return 'Next: check that the version you use contains the fix, then remove the comment.';
};
