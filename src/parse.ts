/**
 * Keywords that mark a comment as a watched TODO when no other keywords are configured.
 */
export const DEFAULT_KEYWORDS: Array<string> = ['TODO'];

/**
 * A whitespace-separated piece of text with its offsets in the parsed string.
 */
export type Token = {
  text: string;
  start: number;
  end: number;
};

export const RefKinds = {
  URL: 'url',
  SHORT: 'short',
  /** `#123` in the repository of the project. */
  LOCAL: 'local',
} as const;

export type RefKind = (typeof RefKinds)[keyof typeof RefKinds];

/**
 * A reference to a GitHub issue or pull request: a full URL, `owner/repo#123`, or `#123` in the
 * repository of the project.
 */
export type TodoRef = Token & {
  kind: RefKind;
  owner: string;
  repo: string;
  number: number;
};

/**
 * One comma-separated entry inside the parentheses of a TODO.
 */
export type TodoEntry = Token & {
  /** The first token that parses as a GitHub reference. */
  ref: TodoRef | undefined;
  /** A `#123` reference that cannot be resolved, because the repository of the project is unknown. */
  unresolved: Token | undefined;
  /** All remaining tokens. */
  unknown: Array<Token>;
};

/**
 * Owner and name of the repository that `#123` references point to.
 */
export type Repository = {
  owner: string;
  repo: string;
};

export type TodoComment = Token & {
  keyword: string;
  entries: Array<TodoEntry>;
};

const URL_REF_RE = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d+)(?:[/?#]\S*)?$/;
const SHORT_REF_RE = /^([\w.-]+)\/([\w.-]+)#(\d+)$/;
const LOCAL_REF_RE = /^#(\d+)$/;

/**
 * A comma separates two entries only if a reference follows it. A comma inside other text, like
 * a URL query, does not.
 */
const ENTRY_SEPARATOR_RE = /,(?=\s*(?:https?:\/\/|[\w.-]+\/[\w.-]+#\d|#\d))/g;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replaces the leading `*` of continuation lines in block comments with a space.
 * The length of the text stays the same, so all offsets stay valid.
 */
const maskLineStars = (text: string) => text.replace(/(\n[ \t]*)\*/g, '$1 ');

/**
 * Parses a GitHub issue or pull request reference. Any hash or query of a URL is kept in `text`
 * but ignored for the parsed parts. `#123` needs the repository of the project.
 */
export const parseRef = (token: Token, repository?: Repository): TodoRef | undefined => {
  const url = URL_REF_RE.exec(token.text);
  if (url) {
    return { ...token, kind: RefKinds.URL, owner: url[1]!, repo: url[2]!, number: Number(url[3]) };
  }

  const short = SHORT_REF_RE.exec(token.text);
  if (short) {
    return { ...token, kind: RefKinds.SHORT, owner: short[1]!, repo: short[2]!, number: Number(short[3]) };
  }

  const local = LOCAL_REF_RE.exec(token.text);
  if (local && repository) {
    return { ...token, kind: RefKinds.LOCAL, ...repository, number: Number(local[1]) };
  }

  return undefined;
};

/**
 * Formats a reference in the short form that fits the project: `#123` in the repository of the
 * project, else `owner/repo#123`.
 */
export const formatShortRef = (ref: Pick<TodoRef, 'owner' | 'repo' | 'number'>, repository?: Repository): string =>
  repository &&
  repository.owner.toLowerCase() === ref.owner.toLowerCase() &&
  repository.repo.toLowerCase() === ref.repo.toLowerCase()
    ? `#${ref.number}`
    : `${ref.owner}/${ref.repo}#${ref.number}`;

/**
 * Builds the canonical URL of a reference. GitHub redirects `/issues/N` to `/pull/N` for pull
 * requests, so the type of the target does not need to be known.
 */
export const toRefUrl = (ref: Pick<TodoRef, 'owner' | 'repo' | 'number'>): string =>
  `https://github.com/${ref.owner}/${ref.repo}/issues/${ref.number}`;

const tokenize = (text: string, offset: number): Array<Token> =>
  Array.from(text.matchAll(/\S+/g), (match) => ({
    text: match[0],
    start: offset + match.index,
    end: offset + match.index + match[0].length,
  }));

const parseEntry = (text: string, offset: number, repository: Repository | undefined): TodoEntry => {
  let ref: TodoRef | undefined;
  let unresolved: Token | undefined;
  const unknown: Array<Token> = [];

  for (const token of tokenize(text, offset)) {
    const parsed = ref || unresolved ? undefined : parseRef(token, repository);
    if (parsed) {
      ref = parsed;
      continue;
    }

    if (!ref && !unresolved && LOCAL_REF_RE.test(token.text)) {
      unresolved = token;
      continue;
    }

    unknown.push(token);
  }

  const trimmed = text.trim();
  const start = offset + text.indexOf(trimmed);

  return { text: trimmed, start, end: start + trimmed.length, ref, unresolved, unknown };
};

/**
 * Splits the text inside the parentheses into entries with their offsets.
 */
const splitEntries = (inner: string) => {
  const parts: Array<{ text: string; offset: number }> = [];
  let start = 0;
  for (const match of inner.matchAll(ENTRY_SEPARATOR_RE)) {
    parts.push({ text: inner.slice(start, match.index), offset: start });
    start = match.index + 1;
  }
  parts.push({ text: inner.slice(start), offset: start });
  return parts;
};

/**
 * Finds all `KEYWORD(...)` occurrences in a comment text and parses their comma-separated entries.
 * Offsets are relative to `text`. A keyword without closing parenthesis is ignored. `#123`
 * references are resolved against `repository`.
 */
export const parseTodos = (
  text: string,
  keywords: Array<string> = DEFAULT_KEYWORDS,
  repository?: Repository,
): Array<TodoComment> => {
  if (keywords.length === 0) return [];

  const pattern = new RegExp(`\\b(${keywords.map(escapeRegExp).join('|')})\\(([^)]*)\\)`, 'g');
  const todos: Array<TodoComment> = [];

  for (const match of maskLineStars(text).matchAll(pattern)) {
    const keyword = match[1]!;
    const inner = match[2]!;
    const innerStart = match.index + keyword.length + 1;

    const entries: Array<TodoEntry> = [];
    for (const part of splitEntries(inner)) {
      if (part.text.trim()) entries.push(parseEntry(part.text, innerStart + part.offset, repository));
    }

    todos.push({ text: match[0], start: match.index, end: match.index + match[0].length, keyword, entries });
  }

  return todos;
};
