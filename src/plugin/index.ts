import { definePlugin, type Plugin } from '@oxlint/plugins';
import { DEFAULT_SEVERITIES, RuleNames } from '../evaluate/types.js';
import { createWorkerProvider, type StatusProvider } from './provider.js';
import { createActivityRule, createInvalidRule, createResolvedRule, formatRule } from './rules.js';
import { PLUGIN_NAME } from './settings.js';

/**
 * Rule severities of the recommended config.
 */
export const recommendedRules = {
  [`${PLUGIN_NAME}/${RuleNames.FORMAT}`]: DEFAULT_SEVERITIES.format,
  [`${PLUGIN_NAME}/${RuleNames.INVALID}`]: DEFAULT_SEVERITIES.invalid,
  [`${PLUGIN_NAME}/${RuleNames.RESOLVED}`]: DEFAULT_SEVERITIES.resolved,
  [`${PLUGIN_NAME}/${RuleNames.ACTIVITY}`]: DEFAULT_SEVERITIES.activity,
} as const;

export type TodoWatchPlugin = Plugin & {
  configs: {
    recommended: { plugins: Record<string, Plugin>; rules: typeof recommendedRules };
  };
};

/**
 * Creates the plugin with a custom status provider, e.g. to test rules without network access.
 */
export const createPlugin = (provider: StatusProvider): TodoWatchPlugin => {
  const plugin = definePlugin({
    meta: { name: PLUGIN_NAME },
    rules: {
      [RuleNames.FORMAT]: formatRule,
      [RuleNames.INVALID]: createInvalidRule(provider),
      [RuleNames.RESOLVED]: createResolvedRule(provider),
      [RuleNames.ACTIVITY]: createActivityRule(provider),
    },
  });

  return Object.assign(plugin, {
    configs: { recommended: { plugins: { [PLUGIN_NAME]: plugin }, rules: recommendedRules } },
  });
};

export const plugin = createPlugin(createWorkerProvider());
