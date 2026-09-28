import { execFileSync } from 'node:child_process';
import { basename, dirname } from 'node:path';

/**
 * Finds when a reference was added to a file. `line` is 1-based.
 */
export type AddedAtLookup = (file: string, refText: string, line: number) => Date | undefined;

const UNCOMMITTED_SHA_RE = /^0{40}\b/;

const git = (cwd: string, args: Array<string>): string | undefined => {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return undefined;
  }
};

const toDate = (value: string | undefined): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/**
 * The first commit that added the reference text to the file, following renames. This is more
 * exact than blame, because later edits of the same line, like formatting, do not move it.
 */
const fromPickaxe = (file: string, refText: string): Date | undefined => {
  const output = git(dirname(file), [
    'log',
    '--follow',
    '--reverse',
    '--format=%aI',
    `-S${refText}`,
    '--',
    basename(file),
  ]);
  return toDate(output?.split('\n').find(Boolean));
};

/**
 * The commit that last changed the line, for references whose text was changed after they were
 * added, e.g. a short reference that was expanded to a URL.
 */
const fromBlame = (file: string, line: number): Date | undefined => {
  const output = git(dirname(file), ['blame', '--porcelain', '-L', `${line},${line}`, '--', basename(file)]);
  if (!output || UNCOMMITTED_SHA_RE.test(output)) return undefined;

  const time = /^author-time (\d+)$/m.exec(output)?.[1];
  return time ? new Date(Number(time) * 1_000) : undefined;
};

/**
 * Creates a lookup that uses the author date of git commits, which a rebase does not change.
 * It returns `undefined` for code that is not committed yet and outside of git. Results are kept
 * for the lifetime of the lookup.
 */
export const createHistoryLookup = (): AddedAtLookup => {
  const results = new Map<string, Date | undefined>();

  return (file, refText, line) => {
    const key = `${file}\0${refText}\0${line}`;
    if (!results.has(key)) results.set(key, fromPickaxe(file, refText) ?? fromBlame(file, line));
    return results.get(key);
  };
};
