import { FailureReasons, formatRef, toRefKey, type StatusResult } from '../github/types.js';
import { RefKinds, type TodoRef } from '../parse.js';
import { describeTarget, fixCommand } from './messages.js';
import { editOf, RuleNames, type Finding, type RefTarget, type Tool } from './types.js';

export type InvalidOptions = {
  /** Report once per file if GitHub cannot be reached or no token is available. */
  reportUnavailable: boolean;
};

export const UNAVAILABLE_MESSAGE_ID = 'unavailable';

const URL_PREFIX_RE = /^https?:\/\/(?:www\.)?github\.com\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+/;

/**
 * Builds the new text of a moved reference. A URL keeps everything after the number, like a
 * comment hash, and a short reference stays short.
 */
const movedText = (ref: TodoRef, target: { owner: string; repo: string; number: number; url: string }) => {
  if (ref.kind === RefKinds.SHORT) return formatRef(target);

  const suffix = ref.text.replace(URL_PREFIX_RE, '');
  return `${target.url}${suffix}`;
};

/**
 * Checks that a reference exists and has not moved. Unavailable results are reported too, and
 * the caller decides how often to show them.
 */
export const evaluateInvalid = (target: RefTarget, result: StatusResult, tool: Tool): Array<Finding> => {
  const { ref } = target;
  const base = { rule: RuleNames.INVALID, token: ref, ref } as const;

  if (!result.ok) {
    if (result.reason === FailureReasons.NOT_FOUND) {
      return [
        {
          ...base,
          messageId: 'notFound',
          summary: `${ref.text} was not found, or the GitHub token has no access to it.`,
          details: [
            'Next: check the reference for typos. If the issue was deleted, remove the TODO. If the repo is private, check that the GitHub token can read it.',
          ],
        },
      ];
    }

    return [
      {
        ...base,
        messageId: UNAVAILABLE_MESSAGE_ID,
        summary: `Could not check the status of ${ref.text}: ${result.message}`,
        details: [
          'Next: set GITHUB_TOKEN or GH_TOKEN, or run `gh auth login`. If the network is down, try again later.',
        ],
      },
    ];
  }

  const { status } = result;
  if (toRefKey(status) === toRefKey(ref)) return [];

  const replacement = movedText(ref, status);
  return [
    {
      ...base,
      messageId: 'moved',
      summary: `${ref.text} has moved to ${describeTarget(status)}.`,
      details: [`URL: ${status.url}`, `Next: ${fixCommand(tool)}, or replace "${ref.text}" with "${replacement}".`],
      fix: editOf(ref, replacement),
    },
  ];
};
