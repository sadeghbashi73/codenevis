import fs from 'node:fs';

/**
 * Thin GitHub REST client — just the calls the pipeline needs.
 * Auth comes from GH_PAT if present (so chained workflow triggers work),
 * otherwise the workflow's GITHUB_TOKEN.
 */

const API = process.env.GITHUB_API_URL || 'https://api.github.com';

export const REPO = process.env.GITHUB_REPOSITORY || '';
const TOKEN = process.env.GH_PAT || process.env.GITHUB_TOKEN || '';

/** True when we hold a personal access token rather than the ephemeral one. */
export const HAS_PAT = Boolean(process.env.GH_PAT);

async function api(method, path, body) {
  if (!REPO) throw new Error('GITHUB_REPOSITORY is not set');
  if (!TOKEN) throw new Error('no GitHub token — set GITHUB_TOKEN or GH_PAT');
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      'user-agent': 'codenevis-agents',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub ${method} ${path} -> ${res.status}: ${text.slice(0, 600)}`);
  }
  return text ? JSON.parse(text) : null;
}

const r = (path) => `/repos/${REPO}${path}`;

/* ---------------------------------- issues --------------------------------- */

export const getIssue = (n) => api('GET', r(`/issues/${n}`));

export const createIssue = ({ title, body, labels = [] }) =>
  api('POST', r('/issues'), { title, body, labels });

export const commentOnIssue = (n, body) =>
  api('POST', r(`/issues/${n}/comments`), { body });

export const listIssueComments = (n) =>
  api('GET', r(`/issues/${n}/comments?per_page=100`));

export const addLabels = (n, labels) =>
  api('POST', r(`/issues/${n}/labels`), { labels });

export async function removeLabel(n, label) {
  try {
    await api('DELETE', r(`/issues/${n}/labels/${encodeURIComponent(label)}`));
  } catch (err) {
    if (!/404/.test(err.message)) throw err;
  }
}

export const closeIssue = (n, reason = 'completed') =>
  api('PATCH', r(`/issues/${n}`), { state: 'closed', state_reason: reason });

export const listIssues = ({ labels, state = 'open' } = {}) => {
  const q = new URLSearchParams({ state, per_page: '100', sort: 'created', direction: 'asc' });
  if (labels) q.set('labels', labels);
  return api('GET', r(`/issues?${q}`));
};

export async function ensureLabels(labels) {
  for (const { name, color, description } of labels) {
    try {
      await api('POST', r('/labels'), { name, color, description });
    } catch (err) {
      if (!/422/.test(err.message)) throw err;
    }
  }
}

/* ----------------------------------- PRs ----------------------------------- */

export const createPR = ({ title, head, base, body, draft = false }) =>
  api('POST', r('/pulls'), { title, head, base, body, draft });

export const getPR = (n) => api('GET', r(`/pulls/${n}`));

export const listOpenPRs = () => api('GET', r('/pulls?state=open&per_page=100'));

export async function getPRDiff(n) {
  const res = await fetch(`${API}${r(`/pulls/${n}`)}`, {
    headers: {
      accept: 'application/vnd.github.v3.diff',
      authorization: `Bearer ${TOKEN}`,
      'user-agent': 'codenevis-agents',
    },
  });
  if (!res.ok) throw new Error(`diff fetch failed: ${res.status}`);
  return res.text();
}

export const listPRFiles = (n) => api('GET', r(`/pulls/${n}/files?per_page=100`));

/**
 * Post a review. GitHub refuses APPROVE on a PR opened by the same identity,
 * which is exactly our case when the dev agent used GITHUB_TOKEN — so we fall
 * back to a plain comment review rather than failing the run.
 */
export async function createReview(n, { event, body }) {
  try {
    return await api('POST', r(`/pulls/${n}/reviews`), { event, body });
  } catch (err) {
    if (event === 'APPROVE' && /422/.test(err.message)) {
      console.log('APPROVE rejected (cannot approve own PR) — posting as a comment instead');
      return api('POST', r(`/pulls/${n}/reviews`), { event: 'COMMENT', body });
    }
    throw err;
  }
}

export const mergePR = (n, { title, method = 'squash' } = {}) =>
  api('PUT', r(`/pulls/${n}/merge`), { merge_method: method, commit_title: title });

export async function deleteBranch(name) {
  try {
    await api('DELETE', r(`/git/refs/heads/${name}`));
  } catch (err) {
    if (!/(404|422)/.test(err.message)) throw err;
  }
}

/* --------------------------------- helpers --------------------------------- */

export function summaryLine(text) {
  const out = process.env.GITHUB_STEP_SUMMARY;
  if (!out) return;
  fs.appendFileSync(out, `${text}\n`);
}

export function setOutput(key, value) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  const delim = `__cn_${Math.random().toString(36).slice(2)}`;
  fs.appendFileSync(out, `${key}<<${delim}\n${String(value ?? '')}\n${delim}\n`);
}
