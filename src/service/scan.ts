import { toRefKey, type RefId } from '../github/types.js';
import { parseTodos } from '../parse.js';
import { listFiles, readSourceFile } from './files.js';
import { resolveRepository } from './repo.js';

const SOURCE_FILE_RE = /\.(?:[cm]?[jt]sx?)$/;

/**
 * Finds all watched references in the JavaScript and TypeScript files of the project, so they
 * can be fetched in one request before the first file is linted.
 */
export const scanRefs = (cwd: string, keywords: Array<string>, repo?: string): Array<RefId> => {
  const refs = new Map<string, RefId>();
  const repository = resolveRepository(cwd, repo);

  for (const path of listFiles(cwd).filter((file) => SOURCE_FILE_RE.test(file))) {
    const file = readSourceFile(cwd, path);
    if (!file) continue;

    for (const todo of parseTodos(file.text, keywords, repository)) {
      for (const entry of todo.entries) {
        if (entry.ref) refs.set(toRefKey(entry.ref), entry.ref);
      }
    }
  }

  return [...refs.values()].map(({ owner, repo, number }) => ({ owner, repo, number }));
};
