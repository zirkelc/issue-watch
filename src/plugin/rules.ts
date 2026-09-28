import { defineRule, type Context, type Rule } from '@oxlint/plugins';
import {
  DEFAULT_ACTIVITY_OPTIONS,
  evaluateActivity,
  MARK_SEEN_MESSAGE_ID,
  OptionalEvents,
  type ActivityOptions,
} from '../evaluate/activity.js';
import { evaluateFormat, type FormatOptions } from '../evaluate/format.js';
import { evaluateInvalid, UNAVAILABLE_MESSAGE_ID, type InvalidOptions } from '../evaluate/invalid.js';
import { evaluateResolved, type ResolvedOptions } from '../evaluate/resolved.js';
import { formatMessage, Tools, type Finding } from '../evaluate/types.js';
import type { StatusProvider } from './provider.js';
import { getSettings } from './settings.js';
import { visitRefStatuses } from './status.js';
import { findEntries, type EntryInFile } from './todos.js';

/**
 * The checks build the whole text, so every message only prints it.
 */
const messagesFor = (ids: Array<string>) => Object.fromEntries(ids.map((id) => [id, '{{message}}']));

const report = (context: Context, { locOf, rangeOf }: Omit<EntryInFile, 'entry'>, finding: Finding) => {
  const { verbose } = getSettings(context.settings);
  const { fix, suggestion } = finding;

  context.report({
    loc: locOf(finding.token),
    messageId: finding.messageId,
    data: { message: formatMessage(finding, verbose) },
    ...(fix ? { fix: (fixer) => fixer.replaceTextRange(rangeOf(fix), fix.text) } : {}),
    ...(suggestion
      ? {
          suggest: [
            {
              messageId: suggestion.messageId,
              data: { message: suggestion.description },
              fix: (fixer) => fixer.replaceTextRange(rangeOf(suggestion.edit), suggestion.edit.text),
            },
          ],
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
    docs: { description: 'Enforce a valid GitHub reference and seen marker in TODO comments.' },
    messages: messagesFor(['invalidRef', 'unexpectedText', 'missingSeen', 'invalidSeen', 'futureSeen', 'shortRef']),
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
    const { keywords } = getSettings(context.settings);

    return {
      Program() {
        const now = new Date();
        for (const found of findEntries(context, keywords)) {
          for (const finding of evaluateFormat(found.entry, options, now, Tools.LINT)) {
            report(context, found, finding);
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

export const createResolvedRule = (provider: StatusProvider): Rule =>
  defineRule({
    meta: {
      type: 'suggestion',
      hasSuggestions: true,
      docs: {
        description:
          'Report TODO references to GitHub issues that are closed or pull requests that are merged or closed.',
      },
      messages: messagesFor([
        'completed',
        'notPlanned',
        'duplicate',
        'merged',
        'closedUnmerged',
        'replaceWithDuplicate',
      ]),
      schema: [
        {
          type: 'object',
          properties: { waitForRelease: { type: 'boolean' } },
          additionalProperties: false,
        },
      ],
      defaultOptions: [{ waitForRelease: false }],
    },
    create(context) {
      const options = optionsOf<ResolvedOptions>(context, { waitForRelease: false });

      return {
        Program() {
          visitRefStatuses(context, provider, (found, result) => {
            for (const finding of evaluateResolved(found, result, options)) report(context, found, finding);
          });
        },
      };
    },
  });

export const createActivityRule = (provider: StatusProvider): Rule =>
  defineRule({
    meta: {
      type: 'suggestion',
      hasSuggestions: true,
      docs: {
        description: 'Report new activity on open GitHub issues and pull requests since the seen marker of a TODO.',
      },
      messages: messagesFor(['activity', MARK_SEEN_MESSAGE_ID]),
      schema: [
        {
          type: 'object',
          properties: {
            ignoreAuthors: { type: 'array', items: { type: 'string' } },
            include: { type: 'array', items: { type: 'string', enum: Object.values(OptionalEvents) } },
          },
          additionalProperties: false,
        },
      ],
      defaultOptions: [DEFAULT_ACTIVITY_OPTIONS],
    },
    create(context) {
      const options = optionsOf<ActivityOptions>(context, DEFAULT_ACTIVITY_OPTIONS);

      return {
        Program() {
          visitRefStatuses(context, provider, (found, result) => {
            for (const finding of evaluateActivity(found, result, options, Tools.LINT)) {
              report(context, found, finding);
            }
          });
        },
      };
    },
  });
