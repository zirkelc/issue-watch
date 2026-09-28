import { plugin } from './plugin/index.js';

export { createPlugin, recommendedRules } from './plugin/index.js';
export type { TodoWatchPlugin } from './plugin/index.js';
export type { StatusProvider } from './plugin/provider.js';
export type { NetworkMode, TodoWatchSettings } from './plugin/settings.js';

export default plugin;
