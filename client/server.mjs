#!/usr/bin/env node
/**
 * codenevis control panel — a local dashboard for the agent pipeline.
 *
 *   node client/server.mjs            then open http://127.0.0.1:4317
 *
 * It binds to the loopback interface only. Nothing is exposed to the network,
 * and no credential is ever written to the repository:
 *
 *   - the GitHub token comes from `gh auth token`, $GITHUB_TOKEN, or
 *     .codenevis/local.json (gitignored)
 *   - agent API keys are written straight into GitHub Actions secrets through
 *     the `gh` CLI, which encrypts them before they leave the machine. The
 *     panel can tell you *whether* a secret is set and when it changed, never
 *     what it contains — GitHub cannot read them back either.
 */

import { createServer } from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PUBLIC = path.join(HERE, 'public');
const LOCAL_CONFIG = path.join(ROOT, '.codenevis', 'local.json');

const PORT = Number(process.env.CODENEVIS_PORT) || 4317;
const HOST = '127.0.0.1';

/* ------------------------------------------------------------------ */
/* credentials and repository                                          */
/* ------------------------------------------------------------------ */

function readLocalConfig() {
  try {
    return JSON.parse(fs.readFileSync(LOCAL_CONFIG, 'utf8'));
  } catch {
    return {};
  }
}

function writeLocalConfig(patch) {
  const next = { ...readLocalConfig(), ...patch };
  fs.mkdirSync(path.dirname(LOCAL_CONFIG), { recursive: true });
  fs.writeFileSync(LOCAL_CONFIG, JSON.stringify(next, null, 2));
  return next;
}

function ghAvailable() {
  try {
    execFileSync('gh', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function resolveToken() {
  const local = readLocalConfig();
  if (local.token) return local.token;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function resolveRepo() {
  const local = readLocalConfig();
  if (local.repo) return local.repo;
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    const m = /github\.com[:/](.+?)(?:\.git)?$/.exec(url);
    if (m) return m[1];
  } catch {
    /* not a git checkout */
  }
  return process.env.GITHUB_REPOSITORY || null;
}

let TOKEN = resolveToken();
let REPO = resolveRepo();

/* ------------------------------------------------------------------ */
/* GitHub                                                              */
/* ------------------------------------------------------------------ */

const API = 'https://api.github.com';

async function gh(method, endpoint, body) {
  if (!TOKEN) throw new Error('No GitHub token. Run `gh auth login`, or set one in the panel.');
  if (!REPO) throw new Error('No repository. Set one in the panel.');
  const url = endpoint.startsWith('http') ? endpoint : `${API}/repos/${REPO}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      'user-agent': 'codenevis-panel',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`GitHub ${method} ${endpoint} -> ${res.status}: ${text.slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

const labelNames = (item) => (item.labels ?? []).map((l) => l.name ?? l);

const STATUS_ORDER = ['status:in-progress', 'status:review', 'status:changes-requested', 'status:todo', 'status:done'];

function statusOf(issue) {
  const labels = labelNames(issue);
  if (labels.includes('needs:human')) return 'blocked';
  if (issue.state === 'closed') return 'done';
  for (const s of STATUS_ORDER) {
    if (labels.includes(s)) return s.replace('status:', '');
  }
  return 'todo';
}

function orderOf(issue) {
  const m = /<!--\s*codenevis:task order=(\d+)/.exec(issue.body ?? '');
  if (m) return Number(m[1]);
  const t = /^\[T(\d+)\]/.exec(issue.title ?? '');
  return t ? Number(t[1]) : 9999;
}

/** Which agent wrote a comment, inferred from the markers the agents leave. */
function authorRole(body = '', login = '') {
  if (body.includes('codenevis:qc-changes') || /QC agent/.test(body)) return 'qc';
  if (/Developer agent/.test(body)) return 'dev';
  if (/PO agent/.test(body)) return 'po';
  if (/^### Pipeline run|^## Pipeline run/m.test(body)) return 'pipeline';
  if (/\[bot\]$/.test(login)) return 'bot';
  return 'human';
}

/* ------------------------------------------------------------------ */
/* aggregated state                                                    */
/* ------------------------------------------------------------------ */

async function buildState() {
  const [openIssues, closedIssues, prs, runs] = await Promise.all([
    gh('GET', '/issues?state=open&per_page=100&sort=created&direction=asc'),
    gh('GET', '/issues?state=closed&per_page=100&sort=updated&direction=desc'),
    gh('GET', '/pulls?state=all&per_page=50&sort=updated&direction=desc'),
    gh('GET', '/actions/runs?per_page=20').then((r) => r.workflow_runs ?? []).catch(() => []),
  ]);

  const issues = [...openIssues, ...closedIssues].filter((i) => !i.pull_request);
  const byNumber = new Map(issues.map((i) => [i.number, i]));

  const prByIssue = new Map();
  for (const pr of prs) {
    const m = /(?:closes|fixes|resolves)\s+#(\d+)/i.exec(pr.body ?? '');
    if (m) prByIssue.set(Number(m[1]), pr);
  }

  const tasks = issues
    .filter((i) => labelNames(i).includes('task'))
    .map((i) => {
      const pr = prByIssue.get(i.number);
      return {
        number: i.number,
        title: i.title,
        order: orderOf(i),
        status: statusOf(i),
        state: i.state,
        labels: labelNames(i),
        comments: i.comments,
        updated_at: i.updated_at,
        url: i.html_url,
        pr: pr
          ? {
              number: pr.number,
              state: pr.merged_at ? 'merged' : pr.state,
              url: pr.html_url,
              branch: pr.head.ref,
              draft: pr.draft,
            }
          : null,
      };
    })
    .sort((a, b) => a.order - b.order || a.number - b.number);

  const briefs = issues
    .filter((i) => labelNames(i).includes('agent:po'))
    .map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      planned: labelNames(i).includes('po:done'),
      updated_at: i.updated_at,
      url: i.html_url,
    }))
    .sort((a, b) => b.number - a.number);

  const activity = (await gh('GET', '/issues/comments?per_page=30&sort=created&direction=desc').catch(() => []))
    .map((c) => {
      const issueNumber = Number(/\/issues\/(\d+)/.exec(c.issue_url ?? '')?.[1]);
      return {
        id: c.id,
        issue: issueNumber,
        issue_title: byNumber.get(issueNumber)?.title ?? `#${issueNumber}`,
        author: c.user?.login ?? 'unknown',
        role: authorRole(c.body ?? '', c.user?.login ?? ''),
        created_at: c.created_at,
        url: c.html_url,
        excerpt: (c.body ?? '')
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/^#+\s*/gm, '')
          .trim()
          .slice(0, 260),
      };
    });

  const counts = tasks.reduce((acc, t) => ({ ...acc, [t.status]: (acc[t.status] ?? 0) + 1 }), {});

  return {
    repo: REPO,
    tasks,
    briefs,
    activity,
    counts,
    total: tasks.length,
    runs: runs.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      created_at: r.created_at,
      url: r.html_url,
      event: r.event,
    })),
    pipelineRunning: runs.some(
      (r) => r.name === 'Agent pipeline' && ['in_progress', 'queued', 'waiting'].includes(r.status)
    ),
  };
}

/* ------------------------------------------------------------------ */
/* configuration and secrets                                           */
/* ------------------------------------------------------------------ */

const AGENT_SECRETS = [
  { name: 'PO_API_KEY', role: 'po', label: 'Product Owner', blurb: 'Writes the PRD and the backlog' },
  { name: 'DEV_API_KEY', role: 'dev', label: 'Developer', blurb: 'Writes the code' },
  { name: 'QC_API_KEY', role: 'qc', label: 'QC', blurb: 'Reviews and merges' },
  { name: 'CODENEVIS_API_KEY', role: 'shared', label: 'Shared fallback', blurb: 'Used only where a dedicated key is missing' },
  { name: 'GH_PAT', role: 'github', label: 'GitHub token', blurb: 'Optional — lets QC post real approvals' },
];

function agentsConfigPath() {
  return path.join(ROOT, 'config', 'agents.json');
}

function readAgentsConfig() {
  return JSON.parse(fs.readFileSync(agentsConfigPath(), 'utf8'));
}

async function readSecretsState() {
  let secrets = [];
  try {
    secrets = (await gh('GET', '/actions/secrets')).secrets ?? [];
  } catch {
    /* insufficient token scope — fall back to "unknown" */
  }
  const known = new Map(secrets.map((s) => [s.name, s.updated_at]));
  return AGENT_SECRETS.map((s) => ({
    ...s,
    set: known.has(s.name),
    updated_at: known.get(s.name) ?? null,
  }));
}

/** Set a repository secret. `gh` encrypts it locally; the value never hits disk. */
function setSecret(name, value) {
  if (!ghAvailable()) {
    throw new Error(
      'The GitHub CLI is required to set secrets, because the value must be encrypted ' +
        'with the repository public key before it is sent. Install it from https://cli.github.com'
    );
  }
  const res = spawnSync('gh', ['secret', 'set', name, '--repo', REPO], {
    input: value,
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`gh secret set ${name} failed: ${(res.stderr || res.stdout || '').trim()}`);
  }
  return true;
}

function deleteSecret(name) {
  const res = spawnSync('gh', ['secret', 'delete', name, '--repo', REPO], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`gh secret delete ${name} failed: ${(res.stderr || res.stdout || '').trim()}`);
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* routes                                                              */
/* ------------------------------------------------------------------ */

const routes = {
  'GET /api/health': async () => ({
    repo: REPO,
    tokenPresent: Boolean(TOKEN),
    ghCli: ghAvailable(),
    root: ROOT,
  }),

  'GET /api/state': () => buildState(),

  'GET /api/config': async () => ({
    agents: readAgentsConfig(),
    secrets: await readSecretsState(),
    ghCli: ghAvailable(),
  }),

  'POST /api/config': async (body) => {
    const current = readAgentsConfig();
    const next = {
      ...current,
      agents: { ...current.agents, ...(body.agents ?? {}) },
      policy: { ...current.policy, ...(body.policy ?? {}) },
    };
    fs.writeFileSync(agentsConfigPath(), `${JSON.stringify(next, null, 2)}\n`);
    return { saved: true, agents: next, note: 'Commit and push config/agents.json for the change to reach Actions.' };
  },

  'POST /api/secret': async (body) => {
    const { name, value } = body;
    if (!AGENT_SECRETS.some((s) => s.name === name)) throw new Error(`unknown secret: ${name}`);
    if (!value || !value.trim()) throw new Error('the value is empty');
    setSecret(name, value.trim());
    if (name === 'GH_PAT') {
      // A freshly supplied PAT is also the best token for this panel.
      TOKEN = value.trim();
      writeLocalConfig({ token: TOKEN });
    }
    return { set: true, name, secrets: await readSecretsState() };
  },

  'DELETE /api/secret': async (body) => {
    deleteSecret(body.name);
    return { deleted: true, secrets: await readSecretsState() };
  },

  'GET /api/issue': async (_body, query) => {
    const n = Number(query.get('number'));
    const [issue, comments] = await Promise.all([
      gh('GET', `/issues/${n}`),
      gh('GET', `/issues/${n}/comments?per_page=100`),
    ]);
    return {
      issue: {
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        labels: labelNames(issue),
        status: statusOf(issue),
        url: issue.html_url,
        created_at: issue.created_at,
      },
      comments: comments.map((c) => ({
        id: c.id,
        author: c.user?.login ?? 'unknown',
        role: authorRole(c.body ?? '', c.user?.login ?? ''),
        body: (c.body ?? '').replace(/<!--[\s\S]*?-->/g, '').trim(),
        created_at: c.created_at,
        url: c.html_url,
      })),
    };
  },

  'GET /api/pr': async (_body, query) => {
    const n = Number(query.get('number'));
    const [pr, reviews, files] = await Promise.all([
      gh('GET', `/pulls/${n}`),
      gh('GET', `/pulls/${n}/reviews?per_page=50`).catch(() => []),
      gh('GET', `/pulls/${n}/files?per_page=100`).catch(() => []),
    ]);
    return {
      pr: {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.merged_at ? 'merged' : pr.state,
        branch: pr.head.ref,
        url: pr.html_url,
        additions: pr.additions,
        deletions: pr.deletions,
        changed_files: pr.changed_files,
      },
      reviews: reviews.map((r) => ({
        id: r.id,
        author: r.user?.login ?? 'unknown',
        role: authorRole(r.body ?? '', r.user?.login ?? ''),
        state: r.state,
        body: (r.body ?? '').replace(/<!--[\s\S]*?-->/g, '').trim(),
        submitted_at: r.submitted_at,
      })),
      files: files.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
    };
  },

  'POST /api/dispatch': async (body) => {
    const { workflow, inputs = {} } = body;
    const allowed = {
      pipeline: 'pipeline.yml',
      po: 'agent-po.yml',
      dev: 'agent-dev.yml',
      qc: 'agent-qc.yml',
    };
    const file = allowed[workflow];
    if (!file) throw new Error(`unknown workflow: ${workflow}`);
    const ref = readLocalConfig().baseBranch || 'main';
    await gh('POST', `/actions/workflows/${file}/dispatches`, { ref, inputs });
    return { dispatched: workflow, inputs };
  },

  'POST /api/brief': async (body) => {
    const { title, description } = body;
    if (!title?.trim() || !description?.trim()) throw new Error('a title and a description are required');
    const issue = await gh('POST', '/issues', {
      title: title.trim().startsWith('[Brief]') ? title.trim() : `[Brief] ${title.trim()}`,
      body: description.trim(),
      labels: ['agent:po'],
    });
    return { number: issue.number, url: issue.html_url };
  },

  'POST /api/settings': async (body) => {
    if (body.repo) REPO = body.repo.trim();
    if (body.token) TOKEN = body.token.trim();
    writeLocalConfig({
      ...(body.repo ? { repo: REPO } : {}),
      ...(body.token ? { token: TOKEN } : {}),
    });
    return { repo: REPO, tokenPresent: Boolean(TOKEN) };
  },
};

/* ------------------------------------------------------------------ */
/* server                                                              */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  const abs = path.join(PUBLIC, rel);
  if (!abs.startsWith(PUBLIC) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(abs)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(fs.readFileSync(abs));
}

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 2_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);

  const key = `${req.method} ${url.pathname}`;
  const handler = routes[key];
  if (!handler) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `no route for ${key}` }));
    return;
  }

  try {
    const body = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : {};
    const out = await handler(body, url.searchParams);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  } catch (err) {
    console.error(`${key} failed:`, err.message);
    res.writeHead(err.status === 404 ? 404 : 500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`
  codenevis control panel

    http://${HOST}:${PORT}

    repository   ${REPO ?? 'not detected — set it in the panel'}
    github token ${TOKEN ? 'found' : 'missing — run `gh auth login`'}
    gh cli       ${ghAvailable() ? 'available' : 'not installed (needed to set API keys)'}

  Loopback only. Ctrl+C to stop.
`);
});
