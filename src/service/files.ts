import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

const MAX_FILE_SIZE = 1_000_000;
const BINARY_SAMPLE_LENGTH = 8_000;
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git']);

/**
 * File extensions that are checked in directories when no other extensions are configured:
 * JavaScript and TypeScript, the files that the lint plugin checks too.
 */
export const DEFAULT_EXTENSIONS: Array<string> = ['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx'];

/**
 * Normalizes an extension from the options, e.g. `.MD` to `md`.
 */
export const normalizeExtension = (extension: string) => extension.replace(/^\./, '').toLowerCase();

const hasExtension = (path: string, extensions: ReadonlySet<string>) =>
  extensions.has(normalizeExtension(extname(path)));

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

const isFile = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/**
 * Lists the files below the given paths: the tracked and not ignored files in a git repository,
 * else all files except hidden directories and `node_modules`. Files in directories are listed
 * only with one of the extensions, if extensions are given. A path that names a file is always
 * listed, so any file can be checked when it is named explicitly.
 */
export const listFiles = (cwd: string, paths: Array<string> = ['.'], extensions?: Array<string>): Array<string> => {
  const explicit = paths
    .filter((path) => isFile(join(cwd, path)))
    .map((path) => toPosix(relative(cwd, join(cwd, path))));
  const directories = paths.filter((path) => !isFile(join(cwd, path)));
  const allowed = extensions ? new Set(extensions.map(normalizeExtension)) : undefined;

  const found = directories.length === 0 ? [] : (gitFiles(cwd, directories) ?? walkFiles(cwd, directories));
  const filtered = found.filter((path) => !isSkipped(path) && (!allowed || hasExtension(path, allowed)));

  return [...new Set([...explicit, ...filtered])].sort();
};

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
