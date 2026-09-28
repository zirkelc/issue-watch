import { defineRule, type Context, type Rule } from '@oxlint/plugins';
import { evaluateFormat, type FormatOptions } from '../evaluate/format.js';
import { evaluateInvalid, UNAVAILABLE_MESSAGE_ID, type InvalidOptions } from '../evaluate/invalid.js';
import { DEFAULT_ISSUE_OPTIONS, evaluateIssue, REPORTED_ISSUE_STATES, type IssueOptions } from '../evaluate/issue.js';
import {
  DEFAULT_PULL_REQUEST_OPTIONS,
  evaluatePullRequest,
  REPORTED_PULL_REQUEST_STATES,
  type PullRequestOptions,
} from '../evaluate/pull-request.js';
import { formatMessage, Tools, type Finding } from '../evaluate/types.js';
import type { StatusProvider } from './provider.js';
import { getSettings, projectRepository } from './settings.js';
import { visitRefStatuses } from './status.js';
import { findEntries, type EntryInFile } from './todos.js';

/**
 * The checks build the whole text, so every message only prints it.
 */
const messagesFor = (ids: Array<string>) => Object.fromEntries(ids.map((id) => [id, '{{message}}']));

const report = (context: Context, { locOf, rangeOf }: Omit<EntryInFile, 'entry'>, finding: Finding) => {
  const { verbose } = getSettings(context.settings);
  const { fix, suggestions = [] } = finding;

  context.report({
    loc: locOf(finding.token),
    messageId: finding.messageId,
    data: { message: formatMessage(finding, verbose) },
    ...(fix ? { fix: (fixer) => fixer.replaceTextRange(rangeOf(fix), fix.text) } : {}),
    ...(suggestions.length > 0
      ? {
          suggest: suggestions.map((suggestion) => ({
            messageId: suggestion.messageId,
            data: { message: suggestion.description },
            fix: (fixer) => fixer.replaceTextRange(rangeOf(suggestion.edit), suggestion.edit.text),
          })),
        }
      : {}),
  });
};

const optionsOf = <OPTIONS extends object>(context: Context, defaults: OPTIONS): OPTIONS => ({
  ...defaults,
  ...(context.options[0] as Partial<OPTIONS> | undefined),
});

export const formatRule = defineRule({
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: { description: 'Enforce valid GitHub references in TODO comments.' },
    messages: messagesFor(['invalidRef', 'missingRepo', 'unexpectedText', 'shortRef']),
    schema: [
      {
        type: 'object',
        properties: { expandShortRefs: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ expandShortRefs: false }],
  },
  create(context) {
    const options = optionsOf<FormatOptions>(context, { expandShortRefs: false });
    const settings = getSettings(context.settings);

    return {
      Program() {
        const found = findEntries(context, settings.keywords, projectRepository(context.cwd, settings));

        for (const entryInFile of found) {
          for (const finding of evaluateFormat(entryInFile.entry, options, Tools.LINT)) {
            report(context, entryInFile, finding);
          }
        }
      },
    };
  },
});

export const createInvalidRule = (provider: StatusProvider): Rule =>
  defineRule({
    meta: {
      type: 'problem',
      fixable: 'code',
      docs: { description: 'Report references to GitHub issues or pull requests that do not exist or have moved.' },
      messages: messagesFor(['notFound', 'moved', UNAVAILABLE_MESSAGE_ID]),
      schema: [
        {
          type: 'object',
          properties: { reportUnavailable: { type: 'boolean' } },
          additionalProperties: false,
        },
      ],
      defaultOptions: [{ reportUnavailable: true }],
    },
    create(context) {
      const options = optionsOf<InvalidOptions>(context, { reportUnavailable: true });

      return {
        Program() {
          /** A missing token or network fails every reference, so it is reported once per file. */
          let reportedUnavailable = false;

          visitRefStatuses(context, provider, (found, result) => {
            for (const finding of evaluateInvalid(found, result, Tools.LINT)) {
              if (finding.messageId === UNAVAILABLE_MESSAGE_ID) {
                if (!options.reportUnavailable || reportedUnavailable) continue;
                reportedUnavailable = true;
              }
              report(context, found, finding);
            }
          });
        },
      };
    },
  });

const statesSchema = (states: Array<string>) => ({ type: 'array', items: { type: 'string', enum: states } }) as const;

export const createIssueRule = (provider: StatusProvider): Rule =>
  defineRule({
    meta: {
      type: 'suggestion',
      hasSuggestions: true,
      docs: {
        description: 'Report TODO references to GitHub issues that are closed, or open with a merged pull request.',
      },
      messages: messagesFor(['completed', 'notPlanned', 'duplicate', 'linkedMerged', 'replaceWithDuplicate']),
      schema: [
        {
          type: 'object',
          properties: {
            states: statesSchema(REPORTED_ISSUE_STATES),
            linkedPullRequests: { type: 'boolean' },
            waitForRelease: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      ],
      defaultOptions: [DEFAULT_ISSUE_OPTIONS],
    },
    create(context) {
      const options = optionsOf<IssueOptions>(context, DEFAULT_ISSUE_OPTIONS);

      return {
        Program() {
          visitRefStatuses(context, provider, (found, result) => {
            for (const finding of evaluateIssue(found, result, options)) report(context, found, finding);
          });
        },
      };
    },
  });

export const createPullRequestRule = (provider: StatusProvider): Rule =>
  defineRule({
    meta: {
      type: 'suggestion',
      docs: { description: 'Report TODO references to GitHub pull requests that are merged or closed.' },
      messages: messagesFor(['merged', 'closedUnmerged']),
      schema: [
        {
          type: 'object',
          properties: {
            states: statesSchema(REPORTED_PULL_REQUEST_STATES),
            waitForRelease: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      ],
      defaultOptions: [DEFAULT_PULL_REQUEST_OPTIONS],
    },
    create(context) {
      const options = optionsOf<PullRequestOptions>(context, DEFAULT_PULL_REQUEST_OPTIONS);

      return {
        Program() {
          visitRefStatuses(context, provider, (found, result) => {
            for (const finding of evaluatePullRequest(found, result, options)) report(context, found, finding);
          });
        },
      };
    },
  });
