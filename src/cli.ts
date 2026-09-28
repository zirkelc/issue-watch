#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { run } from './cli/run.js';

const readVersion = (): string => {
  try {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: string;
    };
    return packageJson.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
};

process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  version: readVersion(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
