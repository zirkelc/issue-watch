import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Repository } from '../parse.js';

/**
 * Matches the GitHub URL forms of git remotes and `package.json`: `https://github.com/o/r.git`,
 * `git@github.com:o/r.git`, `ssh://git@github.com/o/r`, `git+https://github.com/o/r.git` and
 * `github:o/r`.
 */
const GITHUB_URL_RE = /(?:github\.com[/:]|^github:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

/**
 * The `owner/repo` shorthand of the `repository` field in `package.json`.
 */
const SHORTHAND_RE = /^([\w.-]+)\/([\w.-]+)$/;

/**
 * Remotes in the order they are tried. In a fork, the issues usually live in `upstream`.
 */
const REMOTES = ['upstream', 'origin'];

export const parseRepository = (value: string): Repository | undefined => {
  const match = GITHUB_URL_RE.exec(value.trim()) ?? SHORTHAND_RE.exec(value.trim());
  return match ? { owner: match[1]!, repo: match[2]! } : undefined;
};

const fromRemote = (cwd: string, remote: string): Repository | undefined => {
  try {
    const url = execFileSync('git', ['remote', 'get-url', remote], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    });
    return parseRepository(url);
  } catch {
    return undefined;
  }
};

const fromPackageJson = (cwd: string): Repository | undefined => {
  try {
    const { repository } = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as {
      repository?: string | { url?: string };
    };
    const url = typeof repository === 'string' ? repository : repository?.url;
    return url ? parseRepository(url) : undefined;
  } catch {
    return undefined;
  }
};

const detected = new Map<string, Repository | undefined>();

/**
 * Finds the repository that `#123` references point to: the `upstream` git remote, then the
 * `origin` git remote, then the `repository` field of `package.json`. The result is kept for
 * each directory.
 */
export const detectRepository = (cwd: string): Repository | undefined => {
  if (!detected.has(cwd)) {
    const repository = REMOTES.map((remote) => fromRemote(cwd, remote)).find(Boolean) ?? fromPackageJson(cwd);
    detected.set(cwd, repository);
  }
  return detected.get(cwd);
};

/**
 * Uses a configured `owner/repo` value if one is given, else detects the repository.
 */
export const resolveRepository = (cwd: string, configured: string | undefined): Repository | undefined =>
  configured ? parseRepository(configured) : detectRepository(cwd);
