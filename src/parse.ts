/**
 * Keywords that mark a comment as a watched TODO when no other keywords are configured.
 */
export const DEFAULT_KEYWORDS: Array<string> = ['TODO', 'FIXME'];

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
} as const;

export type RefKind = (typeof RefKinds)[keyof typeof RefKinds];

/**
 * A reference to a GitHub issue or pull request, either as full URL or as `owner/repo#123`.
 */
export type TodoRef = Token & {
  kind: RefKind;
  owner: string;
  repo: string;
  number: number;
};

/**
 * The `seen=YYYY-MM-DDTHH:MMZ` marker that records when the reference was last reviewed.
 * `date` is `undefined` if the value is malformed or not a real date.
 */
export type SeenMarker = Token & {
  value: string;
  date: Date | undefined;
};

/**
 * One comma-separated entry inside the parentheses of a TODO.
 */
export type TodoEntry = Token & {
  /** The first token that parses as a GitHub reference. */
  ref: TodoRef | undefined;
  /** The first token that starts with `seen=`. */
  seen: SeenMarker | undefined;
  /** All remaining tokens. */
  unknown: Array<Token>;
};

export type TodoComment = Token & {
  keyword: string;
  entries: Array<TodoEntry>;
};

const URL_REF_RE = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d+)(?:[/?#]\S*)?$/;
const SHORT_REF_RE = /^([\w.-]+)\/([\w.-]+)#(\d+)$/;
const SEEN_PREFIX = 'seen=';
const SEEN_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replaces the leading `*` of continuation lines in block comments with a space.
 * The length of the text stays the same, so all offsets stay valid.
 */
const maskLineStars = (text: string) => text.replace(/(\n[ \t]*)\*/g, '$1 ');

/**
 * Parses a GitHub issue or pull request reference. Any hash or query of a URL is kept in `text`
 * but ignored for the parsed parts.
 */
export const parseRef = (token: Token): TodoRef | undefined => {
  const url = URL_REF_RE.exec(token.text);
  if (url) {
    return { ...token, kind: RefKinds.URL, owner: url[1]!, repo: url[2]!, number: Number(url[3]) };
  }

  const short = SHORT_REF_RE.exec(token.text);
  if (short) {
    return { ...token, kind: RefKinds.SHORT, owner: short[1]!, repo: short[2]!, number: Number(short[3]) };
  }

  return undefined;
};

/**
 * Formats a date as seen marker value with minute precision, e.g. `2026-09-28T08:51Z`.
 */
export const formatSeen = (date: Date): string => `${date.toISOString().slice(0, 16)}Z`;

/**
 * Parses the value of a seen marker. Rejects values that match the format but are no real date,
 * e.g. `2026-02-30T10:00Z`.
 */
export const parseSeen = (value: string): Date | undefined => {
  if (!SEEN_RE.test(value)) return undefined;

  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || formatSeen(date) !== value) return undefined;

  return date;
};

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

const parseEntry = (text: string, offset: number): TodoEntry => {
  let ref: TodoRef | undefined;
  let seen: SeenMarker | undefined;
  const unknown: Array<Token> = [];

  for (const token of tokenize(text, offset)) {
    if (!seen && token.text.startsWith(SEEN_PREFIX)) {
      const value = token.text.slice(SEEN_PREFIX.length);
      seen = { ...token, value, date: parseSeen(value) };
      continue;
    }

    const parsed = ref ? undefined : parseRef(token);
    if (parsed) {
      ref = parsed;
      continue;
    }

    unknown.push(token);
  }

  const trimmed = text.trim();
  const start = offset + text.indexOf(trimmed);

  return { text: trimmed, start, end: start + trimmed.length, ref, seen, unknown };
};

/**
 * Finds all `KEYWORD(...)` occurrences in a comment text and parses their comma-separated entries.
 * Offsets are relative to `text`. A keyword without closing parenthesis is ignored.
 */
export const parseTodos = (text: string, keywords: Array<string> = DEFAULT_KEYWORDS): Array<TodoComment> => {
  if (keywords.length === 0) return [];

  const pattern = new RegExp(`\\b(${keywords.map(escapeRegExp).join('|')})\\(([^)]*)\\)`, 'g');
  const todos: Array<TodoComment> = [];

  for (const match of maskLineStars(text).matchAll(pattern)) {
    const keyword = match[1]!;
    const inner = match[2]!;
    const innerStart = match.index + keyword.length + 1;

    const entries: Array<TodoEntry> = [];
    let entryStart = 0;
    for (const part of inner.split(',')) {
      if (part.trim()) entries.push(parseEntry(part, innerStart + entryStart));
      entryStart += part.length + 1;
    }

    todos.push({ text: match[0], start: match.index, end: match.index + match[0].length, keyword, entries });
  }

  return todos;
};
