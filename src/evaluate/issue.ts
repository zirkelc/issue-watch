import {
  formatRef,
  IssueStateReasons,
  IssueStates,
  PullRequestStates,
  RefTypes,
  ReleaseStates,
  type IssueStatus,
  type LinkedPullRequest,
  type Release,
  type StatusResult,
} from '../github/types.js';
import { RefKinds } from '../parse.js';
import { replacementText } from './invalid.js';
import { describeRelease, describeTarget, formatDate, nextStepForFix } from './messages.js';
import { editOf, RuleNames, type Finding, type RefTarget } from './types.js';

/**
 * The ways an issue can be closed.
 */
export const ReportedIssueStates = {
  COMPLETED: 'completed',
  NOT_PLANNED: 'not-planned',
  DUPLICATE: 'duplicate',
} as const;

export type ReportedIssueState = (typeof ReportedIssueStates)[keyof typeof ReportedIssueStates];

export const REPORTED_ISSUE_STATES: Array<ReportedIssueState> = Object.values(ReportedIssueStates);

export type IssueOptions = {
  /** The close reasons to report. */
  states: Array<ReportedIssueState>;
  /** Report an open issue when a pull request that is linked to it was merged. */
  linkedPullRequests: boolean;
  /** Do not report a fix until a release contains it. */
  waitForRelease: boolean;
};

export const DEFAULT_ISSUE_OPTIONS: IssueOptions = {
  states: REPORTED_ISSUE_STATES,
  linkedPullRequests: true,
  waitForRelease: false,
};

const closeStateOf = (status: IssueStatus): ReportedIssueState => {
  if (status.stateReason === IssueStateReasons.DUPLICATE) return ReportedIssueStates.DUPLICATE;
  if (status.stateReason === IssueStateReasons.NOT_PLANNED) return ReportedIssueStates.NOT_PLANNED;
  return ReportedIssueStates.COMPLETED;
};

const mergedPullRequests = (status: IssueStatus): Array<LinkedPullRequest> =>
  status.linkedPullRequests.filter((linked) => linked.state === PullRequestStates.MERGED);

/**
 * Picks the most useful release of the merged pull requests of an issue: a release that contains
 * a fix, else a fix that is not released yet.
 */
const bestRelease = (merged: Array<LinkedPullRequest>): Release | undefined => {
  const releases = merged.map((linked) => linked.release);
  return (
    releases.find((release) => release?.state === ReleaseStates.RELEASED) ??
    releases.find((release) => release?.state === ReleaseStates.UNRELEASED)
  );
};

/**
 * Describes the merged pull requests that closed an issue, e.g. ` by o/r#12 "Fix", released in v1.2.3`.
 */
const describeClosingPullRequests = (merged: Array<LinkedPullRequest>): string =>
  merged.length === 0
    ? ''
    : ` by ${merged.map((linked) => `${describeTarget(linked)}${describeRelease(linked.release)}`).join('; ')}`;

/**
 * Reports a closed issue, and an open issue whose linked pull request was merged.
 */
export const evaluateIssue = (target: RefTarget, result: StatusResult, options: IssueOptions): Array<Finding> => {
  if (!result.ok || result.status.type !== RefTypes.ISSUE) return [];

  const { ref } = target;
  const { status } = result;
  const name = describeTarget(status);
  const merged = mergedPullRequests(status);
  const finding = (messageId: string, summary: string, details: Array<string>): Finding => ({
    rule: RuleNames.ISSUE,
    messageId,
    summary,
    details,
    token: ref,
    ref,
  });

  if (status.state === IssueStates.OPEN) {
    if (!options.linkedPullRequests || merged.length === 0) return [];

    const linked = merged.find((candidate) => candidate.release?.state === ReleaseStates.RELEASED) ?? merged[0]!;
    if (options.waitForRelease && linked.release?.state !== ReleaseStates.RELEASED) return [];

    const others = merged.length - 1;
    const more = others > 0 ? `, and ${others} more merged pull request${others === 1 ? '' : 's'}` : '';
    return [
      finding(
        'linkedMerged',
        `${name} is still open, but the linked pull request ${describeTarget(linked)} was merged on ${formatDate(linked.mergedAt)}${describeRelease(linked.release)}${more}.`,
        [`URL: ${linked.url}`, nextStepForFix(linked.release)],
      ),
    ];
  }

  const state = closeStateOf(status);
  if (!options.states.includes(state)) return [];

  const date = formatDate(status.closedAt);
  const details = (next: string) => [`URL: ${status.url}`, next];

  if (state === ReportedIssueStates.DUPLICATE) {
    const duplicate = status.duplicateOf;
    if (!duplicate) {
      return [
        finding(
          'duplicate',
          `${name} was closed as a duplicate of another issue on ${date}.`,
          details('Next: find the original issue on GitHub and replace the reference with it.'),
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
          details(`Next: replace "${ref.text}" with "${replacement}".`),
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

  if (state === ReportedIssueStates.NOT_PLANNED) {
    return [
      finding(
        'notPlanned',
        `${name} was closed as not planned on ${date}.`,
        details(
          'Next: no fix will come from upstream. Remove the comment, or keep it as a plain comment without the reference.',
        ),
      ),
    ];
  }

  const release = bestRelease(merged);
  if (options.waitForRelease && merged.length > 0 && release?.state !== ReleaseStates.RELEASED) return [];

  return [
    finding(
      'completed',
      `${name} was closed as completed on ${date}${describeClosingPullRequests(merged)}.`,
      details(nextStepForFix(release)),
    ),
  ];
};
