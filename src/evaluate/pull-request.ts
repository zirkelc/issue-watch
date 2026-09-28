import { PullRequestStates, RefTypes, ReleaseStates, type StatusResult } from '../github/types.js';
import { describeRelease, describeTarget, formatDate, nextStepForFix } from './messages.js';
import { RuleNames, type Finding, type RefTarget } from './types.js';

/**
 * The ways a pull request can be finished.
 */
export const ReportedPullRequestStates = {
  MERGED: 'merged',
  CLOSED: 'closed',
} as const;

export type ReportedPullRequestState = (typeof ReportedPullRequestStates)[keyof typeof ReportedPullRequestStates];

export const REPORTED_PULL_REQUEST_STATES: Array<ReportedPullRequestState> = Object.values(ReportedPullRequestStates);

export type PullRequestOptions = {
  /** The states to report. `closed` means closed without merge. */
  states: Array<ReportedPullRequestState>;
  /** Do not report a merged pull request until a release contains it. */
  waitForRelease: boolean;
};

export const DEFAULT_PULL_REQUEST_OPTIONS: PullRequestOptions = {
  states: REPORTED_PULL_REQUEST_STATES,
  waitForRelease: false,
};

/**
 * Reports a merged pull request, and a pull request that was closed without merge.
 */
export const evaluatePullRequest = (
  target: RefTarget,
  result: StatusResult,
  options: PullRequestOptions,
): Array<Finding> => {
  if (!result.ok || result.status.type !== RefTypes.PULL_REQUEST) return [];

  const { ref } = target;
  const { status } = result;
  const name = describeTarget(status);
  const finding = (messageId: string, summary: string, next: string): Finding => ({
    rule: RuleNames.PULL_REQUEST,
    messageId,
    summary,
    details: [`URL: ${status.url}`, next],
    token: ref,
    ref,
  });

  if (status.state === PullRequestStates.MERGED) {
    if (!options.states.includes(ReportedPullRequestStates.MERGED)) return [];
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
    if (!options.states.includes(ReportedPullRequestStates.CLOSED)) return [];

    return [
      finding(
        'closedUnmerged',
        `${name} was closed without merge on ${formatDate(status.closedAt)}.`,
        'Next: find out if another pull request replaces it, then update the reference or remove the comment.',
      ),
    ];
  }

  return [];
};
