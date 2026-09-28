<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="assets/logo-light.png" />
  <img src="assets/logo-light.png" alt="todo-watch logo" width="400" />
</picture>

<p align="center">Watch GitHub issues and PRs linked in TODO comments</p>
<p align="center">
  <a href="https://www.npmjs.com/package/todo-watch" alt="todo-watch"><img src="https://img.shields.io/npm/dt/todo-watch?label=todo-watch"></a> <a href="https://github.com/zirkelc/todo-watch/actions/workflows/ci.yml" alt="CI"><img src="https://img.shields.io/github/actions/workflow/status/zirkelc/todo-watch/ci.yml?branch=main"></a>
</p>

</div>

This library checks `TODO(...)` comments that link a GitHub issue or pull request, and tells you when the linked issue or pull request changes. You can use it in two ways:

- **Standalone:** run `npx todo-watch` when you want to know what changed, by hand, in CI, or from a coding agent.
- **As lint rules:** add it to [Oxlint](https://oxc.rs/docs/guide/usage/linter/js-plugins) or [ESLint](https://eslint.org/docs/latest/use/configure/plugins), and see the status of each linked issue in your editor and lint output.

Both ways run the same checks, print the same messages, and share one cache.

## Why?

You link an upstream issue or pull request next to a workaround, and then you forget it. However, you want to know when:

- **A fix lands**: The upstream pull request is merged, or it is contained in a release, so the workaround can go
- **An issue is resolved**: It is closed as completed, as not planned, or as a duplicate of another issue
- **Something new happens**: New comments, a reopen, an approval, or a pull request that will close the issue
- **A link goes bad**: The repo was renamed, the issue was transferred, or it does not exist

This library finds these changes for every linked reference and reports only what changed since you last looked.

## Installation

```bash
npm install --save-dev todo-watch
```

For the standalone CLI, you can also run it without installation: `npx todo-watch`.

A GitHub token is needed to read issues and pull requests. It is read from `GITHUB_TOKEN` or `GH_TOKEN`. If neither is set, it is read from the [GitHub CLI](https://cli.github.com/) with `gh auth token`.

## Usage

### The TODO Format

Put a GitHub reference in the parentheses of a `TODO` or `FIXME` comment. The reference is a full URL, as you copy it from the browser, the short form `owner/repo#123`, or `#123` for an issue in your own repository:

```ts
// TODO(https://github.com/vitest-dev/vitest/issues/11363 seen=2026-09-28T10:03Z): remove this workaround
export const pool = 'forks';
```

The `seen` marker records when you last reviewed the reference, in UTC with minute precision. Only activity after this time is reported. You do not write it by hand: `--fix` adds it, and "mark as seen" updates it after you read the news.

```ts
/** A URL keeps its path and hash, and stays clickable in the editor. */
// TODO(https://github.com/vitest-dev/vitest/issues/11363#issuecomment-5866925885 seen=2026-09-28T10:03Z)

/** The short form. */
// FIXME(vitest-dev/vitest#11363 seen=2026-09-28T10:03Z)

/** An issue or pull request in the repository of your project. */
// TODO(#42 seen=2026-09-28T10:03Z)

/** Watch only some kinds of activity, see the activity check. */
// TODO(vitest-dev/vitest#11363 seen=2026-09-28T10:03Z watch=links,reviews)

/** More than one reference, each with its own seen marker. */
// TODO(vitest-dev/vitest#11363 seen=2026-09-28T10:03Z, oxc-project/oxc#27134 seen=2026-09-28T10:03Z)

/** Not checked: a TODO without a GitHub reference, or a plain link. */
// TODO(zirkelc): clean up
// See https://github.com/vitest-dev/vitest/issues/11363
```

**Your repository** for `#123` is found in this order: the `repo` setting or the `--repo` option, the git remote `upstream`, the git remote `origin`, and the `repository` field in `package.json`. `upstream` comes first because in a fork, the issues live in the upstream repository.

**The first seen marker** is the time the reference was added, not the time `--fix` runs. It is the author date of the commit that added the reference text to the file, or the commit of the line if the reference text changed later. For code that is not committed yet, it is the current time. So a TODO that you wrote a year ago reports everything that happened since then.

### Standalone CLI

Run the CLI in your project. It checks all tracked files in the git repository, in any language, including Markdown:

```bash
npx todo-watch
```

```
src/pool.ts:1:9  warning  activity
  vitest-dev/vitest#11363 "Make the worker start timeout configurable" was updated since 2026-09-28T10:03Z: 1 new comment, linked to pull request vitest-dev/vitest#11372 "feat: add workerStartTimeout option" (open).
  First new comment by AriPerkkio on 2026-09-28: "To me it sounds like there is something seriously wrong if jsdom setup takes longer than a minute..."
  URL: https://github.com/vitest-dev/vitest/issues/11363#issuecomment-5866925885
  Next: read the news and update the code if needed. Then mark it as seen: replace "seen=2026-09-28T10:03Z" with "seen=2026-10-02T08:15Z", or run `todo-watch --mark-seen --ref vitest-dev/vitest#11363`.

src/reporter.ts:3:10  warning  resolved
  oxc-project/oxc#27134 "refactor(ast)!: remove unused `CallExpression::is_symbol_or_symbol_for_call`" was merged on 2026-09-28, not released yet.
  URL: https://github.com/oxc-project/oxc/pull/27134
  Next: keep the workaround until a release contains the fix. Then upgrade and remove the TODO and its workaround.

2 problems (0 errors, 2 warnings) in 2 references.
```

The commands you use most:

```bash
npx todo-watch --fix                                   # add missing seen markers, update moved references
npx todo-watch --mark-seen                             # mark all new activity as seen
npx todo-watch --mark-seen --ref vitest-dev/vitest#11363
npx todo-watch src docs                                # check only these paths
npx todo-watch --format json                           # for agents and scripts
npx todo-watch --format markdown                       # for a pull request comment or an issue
```

The exit code is `0` without errors, `1` with errors, and `2` for invalid options. Use `--fail-on warn` to also fail on warnings. All options are listed in [CLI Options](#cli-options).

### Lint Plugin

Add the plugin to `.oxlintrc.json` and enable the rules:

```json
{
  "jsPlugins": ["todo-watch/oxlint"],
  "rules": {
    "todo-watch/format": "error",
    "todo-watch/invalid": "error",
    "todo-watch/resolved": "warn",
    "todo-watch/activity": "warn"
  }
}
```

For ESLint 9, use the recommended config, which enables the same four rules:

```js
import todoWatch from 'todo-watch/eslint';

export default [todoWatch.configs.recommended];
```

The rules show the same messages as the CLI. `oxlint --fix` adds missing seen markers and updates moved references. To mark activity as seen, apply the "Mark as seen" quick fix in your editor, or run `oxlint --fix-suggestions`.

> [!NOTE]
> Oxlint JS plugins run only on JavaScript and TypeScript files. To also check references in Markdown or other files, use the CLI.

### Using Both

By default, the lint rules fetch statuses from GitHub themselves. The first lint run without a cache then waits a few seconds for GitHub, and so does the editor. To keep linting as fast as without the plugin, let the rules read only the cache, and refresh the cache with the CLI when you want new statuses:

```json
{
  "jsPlugins": ["todo-watch/oxlint"],
  "settings": { "todo-watch": { "network": "cache-only" } }
}
```

```bash
npx todo-watch   # fetches all references and fills the cache that the lint rules read
```

| `network`         | Lint rules                                                               |
| ----------------- | ------------------------------------------------------------------------ |
| `fetch` (default) | Fetch statuses that are not in the cache or older than the cache TTL     |
| `cache-only`      | Read the cache only. A reference that is not in the cache gets no status |
| `off`             | No statuses at all. Only `format` reports                                |

## Checks

Four checks run in the CLI. In the lint plugin, each check is a rule with the same name.

| Check                   | Needs GitHub | Severity | Reports                                                |
| ----------------------- | ------------ | -------- | ------------------------------------------------------ |
| [`format`](#format)     | no           | `error`  | A bad reference, a bad or missing seen marker          |
| [`invalid`](#invalid)   | yes          | `error`  | A reference that does not exist or has moved           |
| [`resolved`](#resolved) | yes          | `warn`   | A closed issue, or a merged or closed pull request     |
| [`activity`](#activity) | yes          | `warn`   | News on an issue or pull request since the seen marker |

Use `--rules` in the CLI, or turn rules on and off in your lint config, to run only some checks.

### `format`

Checks the syntax without network access: the reference, the seen marker, and the watch marker. It also reports `#123` if your repository cannot be found. `--fix` adds a missing seen marker with the time the reference was added (see [The TODO Format](#the-todo-format)).

| CLI                   | Rule option                | Default | Description                                                                            |
| --------------------- | -------------------------- | ------- | -------------------------------------------------------------------------------------- |
| `--expand-short-refs` | `expandShortRefs: boolean` | off     | Report `owner/repo#123` and `#123`. `--fix` replaces them with the full, clickable URL |

### `invalid`

Reports references that GitHub cannot find, and references to renamed repos or transferred issues. `--fix` updates a moved reference and keeps the path and hash of a URL. If GitHub cannot be reached or no token is found, it reports this once, with the next step to fix it.

| CLI  | Rule option                  | Default | Description                                                      |
| ---- | ---------------------------- | ------- | ---------------------------------------------------------------- |
| none | `reportUnavailable: boolean` | on      | Report once per file if GitHub cannot be reached in the lint run |

### `resolved`

Reports references whose target is done. It keeps reporting until you remove or change the TODO. A seen marker does not hide it.

| Target       | State                 | Message                                                                     |
| ------------ | --------------------- | --------------------------------------------------------------------------- |
| Issue        | Closed as completed   | `closed as completed on <date> by <merged pull requests and their release>` |
| Issue        | Closed as not planned | `closed as not planned on <date>`                                           |
| Issue        | Closed as duplicate   | `closed as a duplicate of <issue> on <date>`                                |
| Pull request | Merged                | `merged on <date>, released in <tag>` or `not released yet`                 |
| Pull request | Closed without merge  | `closed without merge on <date>`                                            |

| CLI                  | Rule option               | Default | Description                                                  |
| -------------------- | ------------------------- | ------- | ------------------------------------------------------------ |
| `--wait-for-release` | `waitForRelease: boolean` | off     | Report a merged pull request only when a release contains it |

### `activity`

Reports what happened on an issue or pull request after its seen marker, in one message per reference. Activity is grouped into categories, and you choose which ones to watch:

| Category     | Issue                                                                    | Pull request                              | Default for issues | Default for pull requests |
| ------------ | ------------------------------------------------------------------------ | ----------------------------------------- | ------------------ | ------------------------- |
| `comments`   | New comments (the first one as an excerpt)                               | New comments                              | on                 | on                        |
| `state`      | Reopened                                                                 | Reopened, ready for review, back to draft | on                 | on                        |
| `links`      | Linked to a pull request that will close it, linked one merged or closed | none                                      | on                 | none                      |
| `reviews`    | none                                                                     | Approved, changes requested               | none               | off                       |
| `labels`     | Labels added                                                             | Labels added                              | off                | off                       |
| `milestones` | Milestone set                                                            | Milestone set                             | off                | off                       |

A close or merge is not activity: [`resolved`](#resolved) reports it, and keeps reporting it until you remove the TODO. For a closed or merged target, `activity` reports only new comments, for example a note that the fix was released.

**Precedence** for the watched categories of a reference (highest to lowest):

1. The `watch=` marker in the TODO, e.g. `watch=links,reviews`, or `watch=none` for nothing
2. The option for issues or pull requests (`--watch-issues`, `--watch-prs`, or the rule options `issues.watch`, `pullRequests.watch`)
3. `--watch` in the CLI for both types
4. The defaults: `comments,state,links` for issues, `comments,state` for pull requests

To stop watching a category for one reference, use the "Stop watching ..." quick fix in your editor, or run `todo-watch --unwatch comments --ref vitest-dev/vitest#11363`. Both write the `watch=` marker for you.

| CLI                       | Rule option                              | Default                | Description                                                                 |
| ------------------------- | ---------------------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| `--ignore-authors <list>` | `ignoreAuthors: Array<string>`           | `bots`                 | Comments and reviews to ignore: logins, `bots`, and `self` (the token user) |
| `--watch <list>`          | none                                     | none                   | Categories to watch for issues and pull requests                            |
| `--watch-issues <list>`   | `issues: { watch: Array<string> }`       | `comments,state,links` | Categories to watch for issues                                              |
| `--watch-prs <list>`      | `pullRequests: { watch: Array<string> }` | `comments,state`       | Categories to watch for pull requests                                       |
| `--unwatch <list>`        | none                                     | none                   | Write a `watch=` marker without these categories. Use `--ref` to limit it   |

In the lint config, options go after the severity:

```json
{
  "rules": {
    "todo-watch/activity": [
      "warn",
      {
        "ignoreAuthors": ["bots", "self"],
        "issues": { "watch": ["comments", "links"] },
        "pullRequests": { "watch": ["reviews", "state"] }
      }
    ]
  }
}
```

## Configuration

### CLI Options

`todo-watch [options] [paths...]` checks the tracked and not ignored files below the paths. Paths default to the current directory. `node_modules` is always skipped.

| Option                   | Default      | Description                                            |
| ------------------------ | ------------ | ------------------------------------------------------ |
| `--format <format>`      | `text`       | `text`, `json` or `markdown`                           |
| `--compact`              | off          | Print only the first line of each message              |
| `--quiet`                | off          | Report errors only                                     |
| `--fail-on <level>`      | `error`      | Exit with `1` on `error`, on `warn`, or never (`none`) |
| `--rules <list>`         | all          | Checks to run                                          |
| `--ref <owner/repo#123>` | all          | Check only this reference. Can be repeated             |
| `--keywords <list>`      | `TODO,FIXME` | Comment keywords                                       |
| `--repo <owner/name>`    | detected     | Repository of `#123` references                        |
| `--fix`                  | off          | Add missing seen markers, update moved references      |
| `--mark-seen`            | off          | Mark new activity as seen. Use `--ref` to limit it     |
| `--cache-ttl <minutes>`  | `60`         | How long fetched statuses stay valid                   |
| `--no-cache`             | off          | Fetch all statuses again                               |

The check options are listed with each [check](#checks). The CLI has no config file. Put the options you always use into a script:

```json
{
  "scripts": {
    "todos": "todo-watch --keywords TODO,FIXME,HACK --ignore-authors bots,self --wait-for-release"
  }
}
```

### Lint Settings

Settings are shared by all rules and go under `settings["todo-watch"]`:

```json
{
  "settings": {
    "todo-watch": {
      "network": "fetch",
      "keywords": ["TODO", "FIXME"],
      "cacheTtl": 60,
      "prefetch": true,
      "verbose": true,
      "repo": "vitest-dev/vitest"
    }
  }
}
```

| Setting    | Default             | Description                                                                            |
| ---------- | ------------------- | -------------------------------------------------------------------------------------- |
| `network`  | `fetch`             | `fetch`, `cache-only` or `off`, see [Using Both](#using-both)                          |
| `keywords` | `["TODO", "FIXME"]` | Comment keywords                                                                       |
| `cacheTtl` | `60`                | How long fetched statuses stay valid, in minutes                                       |
| `prefetch` | `true`              | On the first reference, fetch all references of the project at once                    |
| `verbose`  | `true`              | Add the URL, the first new comment and the next step below the first line of a message |
| `repo`     | detected            | Repository of `#123` references, as `owner/name`                                       |

## Advanced

### Messages for Agents

Lint and CLI runs are often done by coding agents, so every message has enough context to act without opening GitHub first. The first line names the reference with its title and says what changed. The next lines give the first new comment, the URL, and the next step, with the exact text to write for the seen marker. `--format json` gives the same content as fields.

> [!NOTE]
> Oxlint's default reporter prints each message on one line, so the detail lines follow the first line with spaces. Use `oxlint --format=stylish` to see them on their own lines. ESLint and the CLI always print them on their own lines.

### Marking as Seen

"Mark as seen" writes the time at which the status was fetched, not the current time, so nothing that happened after the fetch is lost. Everything in the minute of the marker counts as seen.

> [!IMPORTANT]
> `--fix` never marks activity as seen, because you should read it first. Do not put `--mark-seen` or `oxlint --fix-suggestions` in a pre-commit hook.

### Cache

Statuses are cached in `node_modules/.cache/todo-watch/github.json`, or in the temp directory if the project has no `node_modules`. The CLI and the lint rules use the same file. "Not found" results are cached too. Network and token errors are not cached. A release that contains a merge commit is cached forever.

> [!TIP]
> In CI, cache `node_modules/.cache/todo-watch` between runs. Otherwise every CI run fetches all references once.

### Releases

For a merged pull request, the 50 newest tags of the repo are loaded. The compare API then finds the oldest tag after the merge that contains the merge commit.

> [!NOTE]
> If the merge is older than all 50 tags, the first release cannot be found, and it is reported as `released in <tag> or earlier`. In a monorepo, the tag can belong to a different package than the one you use.

### Limitations

> [!IMPORTANT]
>
> - Only GitHub.com is supported. GitHub Enterprise, GitLab, and Jira references are ignored.
> - Only the last 50 comments and the last 100 timeline events of each issue are fetched. On very busy issues, older activity after the seen marker can be missed.
> - The lint plugin checks only JavaScript and TypeScript files. The CLI checks all text files.
> - The CLI finds keywords in any text, not only in comments. A `TODO(owner/repo#123)` in a string is checked too.

## License

MIT
