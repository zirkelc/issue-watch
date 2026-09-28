import {
  EventTypes,
  formatRef,
  IssueStates,
  PullRequestStates,
  RefTypes,
  ReviewStates,
  type Author,
  type Comment,
  type RefStatus,
  type StatusResult,
} from '../github/types.js';
import { formatSeen, formatWatch, WatchCategories, type WatchCategory } from '../parse.js';
import { describeRelease, describeTarget, excerpt, formatDate } from './messages.js';
import { editOf, RuleNames, Tools, type Edit, type Finding, type RefTarget, type Tool } from './types.js';

export const AuthorPresets = {
  /** GitHub Apps and accounts whose login ends with `[bot]`. */
  BOTS: 'bots',
  /** The owner of the GitHub token. */
  SELF: 'self',
} as const;

/**
 * Activity categories of issues that are watched when neither the options nor the TODO select any.
 */
export const DEFAULT_ISSUE_WATCH: Array<WatchCategory> = [
  WatchCategories.COMMENTS,
  WatchCategories.STATE,
  WatchCategories.LINKS,
];

/**
 * Activity categories of pull requests that are watched when neither the options nor the TODO
 * select any. Reviews are off, because a merge or close is what matters for a workaround, and the
 * check for resolved references reports that.
 */
export const DEFAULT_PULL_REQUEST_WATCH: Array<WatchCategory> = [WatchCategories.COMMENTS, WatchCategories.STATE];

export type ActivityOptions = {
  /** Logins whose comments and reviews are not activity, plus the presets `bots` and `self`. */
  ignoreAuthors: Array<string>;
  /** Activity to report for issues, unless a TODO has its own `watch=` marker. */
  issues: { watch: Array<WatchCategory> };
  /** Activity to report for pull requests, unless a TODO has its own `watch=` marker. */
  pullRequests: { watch: Array<WatchCategory> };
};

export const DEFAULT_ACTIVITY_OPTIONS: ActivityOptions = {
  ignoreAuthors: [AuthorPresets.BOTS],
  issues: { watch: DEFAULT_ISSUE_WATCH },
  pullRequests: { watch: DEFAULT_PULL_REQUEST_WATCH },
};

export const MARK_SEEN_MESSAGE_ID = 'markSeen';
export const UNWATCH_MESSAGE_ID = 'unwatch';

const MINUTE_MS = 60_000;

const plural = (count: number, word: string) => `${count} new ${word}${count === 1 ? '' : 's'}`;

type ActivityItem = {
  category: WatchCategory;
  text: string;
};

type Activity = {
  items: Array<ActivityItem>;
  firstComment: Comment | undefined;
};

/**
 * Collects everything that happened after the seen marker, in the watched categories. The seen
 * marker has minute precision and is set to the minute of the fetch, so everything inside that
 * minute counts as seen. Otherwise a comment made in the same minute would be reported again
 * after it was marked as seen.
 */
export const collectActivity = (
  status: RefStatus,
  seen: Date,
  isIgnored: (author: Author | undefined) => boolean,
  watch: ReadonlySet<WatchCategory>,
): Activity => {
  const threshold = new Date(seen.getTime() + MINUTE_MS).toISOString();
  const isNew = (date: string | undefined) => date !== undefined && date >= threshold;
  const items: Array<ActivityItem> = [];
  const add = (category: WatchCategory, text: string) => {
    if (watch.has(category)) items.push({ category, text });
  };

  const comments = status.comments.filter((comment) => isNew(comment.createdAt) && !isIgnored(comment.author));
  if (comments.length > 0) add(WatchCategories.COMMENTS, plural(comments.length, 'comment'));

  for (const event of status.events) {
    if (!isNew(event.createdAt)) continue;

    if (event.type === EventTypes.REOPENED) add(WatchCategories.STATE, 'reopened');
    else if (event.type === EventTypes.READY_FOR_REVIEW) add(WatchCategories.STATE, 'ready for review');
    else if (event.type === EventTypes.CONVERTED_TO_DRAFT) add(WatchCategories.STATE, 'converted to draft');
    else if (event.type === EventTypes.LABELED) add(WatchCategories.LABELS, `labeled "${event.detail}"`);
    else if (event.type === EventTypes.MILESTONED)
      add(WatchCategories.MILESTONES, `added to milestone "${event.detail}"`);
  }

  if (status.type === RefTypes.PULL_REQUEST) {
    for (const review of status.reviews) {
      if (!isNew(review.createdAt) || isIgnored(review.author)) continue;

      const login = review.author?.login ?? 'someone';
      if (review.state === ReviewStates.APPROVED) add(WatchCategories.REVIEWS, `approved by ${login}`);
      else if (review.state === ReviewStates.CHANGES_REQUESTED) {
        add(WatchCategories.REVIEWS, `changes requested by ${login}`);
      }
    }
  } else {
    for (const linked of status.linkedPullRequests) {
      const name = formatRef(linked);
      if (isNew(linked.linkedAt)) {
        add(WatchCategories.LINKS, `linked to pull request ${describeTarget(linked)} (${linked.state.toLowerCase()})`);
      }

      if (linked.state === PullRequestStates.MERGED && isNew(linked.mergedAt)) {
        add(WatchCategories.LINKS, `pull request ${name} merged${describeRelease(linked.release)}`);
      } else if (linked.state === PullRequestStates.CLOSED && isNew(linked.closedAt)) {
        add(WatchCategories.LINKS, `pull request ${name} closed without merge`);
      }
    }
  }

  return { items, firstComment: watch.has(WatchCategories.COMMENTS) ? comments[0] : undefined };
};

/**
 * The watched categories of a reference: the valid `watch=` marker of the TODO, else the option
 * for issues or pull requests.
 */
export const watchedCategories = (target: RefTarget, status: RefStatus, options: ActivityOptions) =>
  target.watch?.categories ??
  (status.type === RefTypes.PULL_REQUEST ? options.pullRequests.watch : options.issues.watch);

/**
 * Builds the edit that stops watching one category: it changes the `watch=` marker, or adds one
 * after the seen marker.
 */
const unwatchEdit = (target: RefTarget, watched: Array<WatchCategory>, category: WatchCategory): Edit => {
  const marker = `watch=${formatWatch(watched.filter((candidate) => candidate !== category))}`;
  if (target.watch) return editOf(target.watch, marker);

  const after = target.seen ?? target.ref;
  return { start: after.end, end: after.end, text: ` ${marker}` };
};

/**
 * Reports what happened on an issue or pull request after the seen marker. A closed or merged
 * target is reported by the check for resolved references, so here it reports only new comments,
 * like a note that a fix was released.
 */
export const evaluateActivity = (
  target: RefTarget,
  result: StatusResult,
  options: ActivityOptions,
  tool: Tool,
): Array<Finding> => {
  const { ref, seen } = target;
  if (!result.ok || !seen?.date) return [];

  const { status, viewer } = result;

  const ignoreAuthors = new Set(options.ignoreAuthors.map((login) => login.toLowerCase()));
  const isIgnored = (author: Author | undefined) => {
    if (!author) return false;
    const login = author.login.toLowerCase();
    if (author.isBot && ignoreAuthors.has(AuthorPresets.BOTS)) return true;
    if (viewer && login === viewer.toLowerCase() && ignoreAuthors.has(AuthorPresets.SELF)) return true;
    return ignoreAuthors.has(login);
  };

  const isOpen =
    status.type === RefTypes.ISSUE ? status.state === IssueStates.OPEN : status.state === PullRequestStates.OPEN;
  const watched = watchedCategories(target, status, options);
  const reportable = isOpen ? watched : watched.filter((category) => category === WatchCategories.COMMENTS);
  const { items, firstComment } = collectActivity(status, seen.date, isIgnored, new Set(reportable));
  if (items.length === 0) return [];

  const marker = `seen=${formatSeen(new Date(result.fetchedAt))}`;
  const markSeenCommand = tool === Tools.CLI ? `, or run \`todo-watch --mark-seen --ref ${formatRef(status)}\`` : '';
  const reported = [...new Set(items.map((item) => item.category))];

  return [
    {
      rule: RuleNames.ACTIVITY,
      messageId: 'activity',
      summary: `${describeTarget(status)} was updated since ${seen.value}: ${items.map((item) => item.text).join(', ')}.`,
      details: [
        ...(firstComment
          ? [
              `First new comment by ${firstComment.author?.login ?? 'someone'} on ${formatDate(firstComment.createdAt)}: "${excerpt(firstComment.body)}"`,
            ]
          : []),
        `URL: ${firstComment?.url ?? status.url}`,
        `Next: read the news and update the code if needed. Then mark it as seen: replace "${seen.text}" with "${marker}"${markSeenCommand}.`,
      ],
      token: ref,
      ref,
      suggestions: [
        { messageId: MARK_SEEN_MESSAGE_ID, description: `Mark ${ref.text} as seen.`, edit: editOf(seen, marker) },
        ...reported.map((category) => ({
          messageId: UNWATCH_MESSAGE_ID,
          description: `Stop watching ${category} on ${ref.text}.`,
          edit: unwatchEdit(target, watched, category),
          category,
        })),
      ],
    },
  ];
};
