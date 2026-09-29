import { plugin } from './plugin/index.js';

export { createPlugin, recommendedRules } from './plugin/index.js';
export type { IssueWatchPlugin } from './plugin/index.js';
export type { StatusProvider } from './plugin/provider.js';
export type { NetworkMode, IssueWatchSettings } from './plugin/settings.js';

export default plugin;
