import { defineConfig } from 'tsdown';

export default defineConfig({
  /**
   * Run arethetypeswrong after bundling.
   * Requires @arethetypeswrong/core to be installed.
   */
  attw: {
    profile: 'esm-only',
  },
  /**
   * Run publint after bundling.
   * Requires publint to be installed.
   */
  publint: true,
  exports: {
    /** The CLI is only a binary, and the worker is loaded by path. */
    exclude: ['cli', 'worker'],
    bin: { 'issue-watch': './src/cli.ts' },
  },
  entry: ['src/index.ts', 'src/oxlint.ts', 'src/eslint.ts', 'src/cli.ts', 'src/worker.ts'],
  format: ['esm'],
});
