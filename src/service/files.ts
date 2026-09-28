import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const MAX_FILE_SIZE = 1_000_000;
const BINARY_SAMPLE_LENGTH = 8_000;
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git']);

export type SourceFile = {
  /** Path relative to the working directory, with forward slashes. */
  path: string;
  text: string;
};

const toPosix = (path: string) => path.split(sep).join('/');

const gitFiles = (cwd: string, paths: Array<string>): Array<string> | undefined => {
  try {
    return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...paths], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\0')
      .filter(Boolean);
  } catch {
    return undefined;
  }
};

/**
 * Walks directories outside of git. Skips `node_modules`, `.git` and other hidden directories.
 */
const walkFiles = (cwd: string, paths: Array<string>): Array<string> => {
  const files: Array<string> = [];

  const visit = (path: string) => {
    let stats;
    try {
      stats = statSync(path);
    } catch {
      return;
    }

    if (stats.isFile()) {
      files.push(toPosix(relative(cwd, path)));
      return;
    }
    if (!stats.isDirectory()) return;

    for (const name of readdirSync(path)) {
      if (SKIPPED_DIRECTORIES.has(name) || name.startsWith('.')) continue;
      visit(join(path, name));
    }
  };

  for (const path of paths) visit(join(cwd, path));
  return files;
};

/**
 * Lists the files below the given paths: the tracked and not ignored files in a git repository,
 * else all files except hidden directories and `node_modules`.
 */
export const listFiles = (cwd: string, paths: Array<string> = ['.']): Array<string> =>
  [...new Set(gitFiles(cwd, paths) ?? walkFiles(cwd, paths))].filter((path) => !isSkipped(path)).sort();

/**
 * Git lists untracked files in `node_modules` if the project has no `.gitignore`, so skipped
 * directories are filtered in every mode.
 */
const isSkipped = (path: string) => path.split('/').some((segment) => SKIPPED_DIRECTORIES.has(segment));

/**
 * Reads a text file. Returns `undefined` for large files, binary files and files that cannot be read.
 */
export const readSourceFile = (cwd: string, path: string): SourceFile | undefined => {
  try {
    const absolute = join(cwd, path);
    if (statSync(absolute).size > MAX_FILE_SIZE) return undefined;

    const text = readFileSync(absolute, 'utf8');
    if (text.slice(0, BINARY_SAMPLE_LENGTH).includes('\0')) return undefined;

    return { path, text };
  } catch {
    return undefined;
  }
};
