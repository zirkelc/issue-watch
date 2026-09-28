import { execFileSync } from 'node:child_process';

const API_URL = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 20_000;

export type GraphqlError = {
  type?: string;
  path?: Array<string | number>;
  message: string;
};

export type GraphqlResponse<DATA> = {
  data?: DATA | null;
  errors?: Array<GraphqlError>;
};

export type RestResponse<DATA> = {
  status: number;
  data: DATA;
};

export type GithubClient = {
  graphql<DATA>(query: string): Promise<GraphqlResponse<DATA>>;
  rest<DATA>(path: string): Promise<RestResponse<DATA>>;
};

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GithubError';
  }
}

/**
 * Finds a GitHub token in `GITHUB_TOKEN` or `GH_TOKEN`, or asks the GitHub CLI for one.
 */
export const resolveToken = (env: NodeJS.ProcessEnv = process.env): string | undefined => {
  const fromEnv = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (fromEnv) return fromEnv;

  try {
    const token = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    }).trim();
    return token || undefined;
  } catch {
    return undefined;
  }
};

export const createClient = (token: string, fetchFn: typeof fetch = fetch): GithubClient => {
  const headers = {
    authorization: `bearer ${token}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'oxlint-plugin-todo-watch',
  };

  const request = async (path: string, init?: RequestInit) => {
    const response = await fetchFn(`${API_URL}${path}`, {
      ...init,
      headers: { ...headers, ...init?.headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 401 || response.status === 403 || response.status >= 500) {
      const text = await response.text().catch(() => '');
      throw new GithubError(`GitHub API responded with ${response.status}: ${text.slice(0, 200)}`, response.status);
    }

    return response;
  };

  return {
    async graphql<DATA>(query: string) {
      const response = await request('/graphql', { method: 'POST', body: JSON.stringify({ query }) });
      return (await response.json()) as GraphqlResponse<DATA>;
    },
    async rest<DATA>(path: string) {
      const response = await request(path);
      return { status: response.status, data: (await response.json()) as DATA };
    },
  };
};
