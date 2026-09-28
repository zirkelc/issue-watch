import {
  formatRef,
  IssueStateReasons,
  IssueStates,
  PullRequestStates,
  RefTypes,
  ReleaseStates,
  type IssueStatus,
  type Release,
  type StatusResult,
} from '../github/types.js';
import { RefKinds } from '../parse.js';
import { replacementText } from './invalid.js';
import { describeRelease, describeTarget, formatDate } from './messages.js';
import { editOf, RuleNames, type Finding, type RefTarget } from './types.js';

export type ResolvedOptions = {
  /** Do not report merged pull requests until a release contains them. */
  waitForRelease: boolean;
};

/**
 * Describes the merged pull requests that closed an issue, e.g. ` by o/r#12 "Fix", released in v1.2.3`.
 */
const describeClosingPullRequests = (status: IssueStatus): string => {
  const merged = status.linkedPullRequests.filter((linked) => linked.state === PullRequestStates.MERGED);
  if (merged.length === 0) return '';

  return ` by ${merged.map((linked) => `${describeTarget(linked)}${describeRelease(linked.release)}`).join('; ')}`;
};

/**
 * Picks the most useful release of the merged pull requests that closed an issue: a release that
 * contains a fix, else a fix that is not released yet.
 */
const closingRelease = (status: IssueStatus): Release | undefined => {
  const releases = status.linkedPullRequests
    .filter((linked) => linked.state === PullRequestStates.MERGED)
    .map((linked) => linked.release);

  return (
    releases.find((release) => release?.state === ReleaseStates.RELEASED) ??
    releases.find((release) => release?.state === ReleaseStates.UNRELEASED)
  );
};

const nextStepForFix = (release: Release | undefined): string => {
  if (release?.state === ReleaseStates.RELEASED) {
    return `Next: upgrade to ${release.tag} or later, then remove the TODO and its workaround.`;
  }
  if (release?.state === ReleaseStates.UNRELEASED) {
    return 'Next: keep the workaround until a release contains the fix. Then upgrade and remove the TODO and its workaround.';
  }
  return 'Next: check that the version you use contains the fix, then remove the TODO and its workaround.';
};

/**
 * Reports a closed issue or a merged or closed pull request. A seen marker does not hide these.
 */
export const evaluateResolved = (target: RefTarget, result: StatusResult, options: ResolvedOptions): Array<Finding> => {
  if (!result.ok) return [];

  const { ref } = target;
  const { status } = result;
  const name = describeTarget(status);
  const date = formatDate(status.closedAt);
  const finding = (messageId: string, summary: string, next: string): Finding => ({
    rule: RuleNames.RESOLVED,
    messageId,
    summary,
    details: [`URL: ${status.url}`, next],
    token: ref,
    ref,
  });

  if (status.type === RefTypes.PULL_REQUEST) {
    if (status.state === PullRequestStates.MERGED) {
      if (options.waitForRelease && status.release?.state !== ReleaseStates.RELEASED) return [];
      return [
        finding(
          'merged',
          `${name} was merged on ${formatDate(status.mergedAt)}${describeRelease(status.release)}.`,
          nextStepForFix(status.release),
        ),
      ];
    }
    if (status.state === PullRequestStates.CLOSED) {
      return [
        finding(
          'closedUnmerged',
          `${name} was closed without merge on ${date}.`,
          'Next: find out if another pull request replaces it. Then update the TODO reference, or keep the workaround and remove the TODO.',
        ),
      ];
    }
    return [];
  }

  if (status.state !== IssueStates.CLOSED) return [];

  if (status.stateReason === IssueStateReasons.DUPLICATE) {
    const duplicate = status.duplicateOf;
    if (!duplicate) {
      return [
        finding(
          'duplicate',
          `${name} was closed as a duplicate of another issue on ${date}.`,
          'Next: find the original issue on GitHub and replace the TODO reference with it. Keep the seen marker.',
        ),
      ];
    }

    /** A hash like `#issuecomment-1` belongs to the closed issue, so a URL gets the plain URL. */
    const replacement = ref.kind === RefKinds.URL ? duplicate.url : replacementText(ref, duplicate);
    return [
      {
        ...finding(
          'duplicate',
          `${name} was closed as a duplicate of ${describeTarget(duplicate)} on ${date}.`,
          `Next: replace "${ref.text}" with "${replacement}". Keep the seen marker.`,
        ),
        suggestions: [
          {
            messageId: 'replaceWithDuplicate',
            description: `Replace the reference with ${formatRef(duplicate)}.`,
            edit: editOf(ref, replacement),
          },
        ],
      },
    ];
  }

  if (status.stateReason === IssueStateReasons.NOT_PLANNED) {
    return [
      finding(
        'notPlanned',
        `${name} was closed as not planned on ${date}.`,
        'Next: no fix will come from upstream. Keep the workaround, and replace the TODO with a normal comment that explains it.',
      ),
    ];
  }

  return [
    finding(
      'completed',
      `${name} was closed as completed on ${date}${describeClosingPullRequests(status)}.`,
      nextStepForFix(closingRelease(status)),
    ),
  ];
};
