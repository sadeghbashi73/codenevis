/**
 * Shared pipeline vocabulary: labels, the task-issue format, and the git
 * plumbing the agents are deliberately not allowed to run themselves.
 */

import { execFileSync } from 'node:child_process';
import * as gh from './github.mjs';
import { REPO_ROOT } from './config.mjs';

export const LABELS = {
  brief: 'agent:po',
  poDone: 'po:done',
  task: 'task',
  dev: 'agent:dev',
  qc: 'agent:qc',
  todo: 'status:todo',
  inProgress: 'status:in-progress',
  review: 'status:review',
  changes: 'status:changes-requested',
  done: 'status:done',
  blocked: 'needs:human',
};

const LABEL_SPECS = [
  { name: LABELS.brief, color: '5319e7', description: 'Project brief for the PO agent' },
  { name: LABELS.poDone, color: 'c5def5', description: 'PO agent has planned this brief' },
  { name: LABELS.task, color: '0e8a16', description: 'A backlog task produced by the PO agent' },
  { name: LABELS.dev, color: '1d76db', description: 'Waiting for the developer agent' },
  { name: LABELS.qc, color: 'fbca04', description: 'Waiting for the QC agent' },
  { name: LABELS.todo, color: 'ededed', description: 'Not started' },
  { name: LABELS.inProgress, color: 'bfd4f2', description: 'Developer agent is working on it' },
  { name: LABELS.review, color: 'fef2c0', description: 'Under QC review' },
  { name: LABELS.changes, color: 'e99695', description: 'QC sent it back to the developer' },
  { name: LABELS.done, color: '0e8a16', description: 'Merged' },
  { name: LABELS.blocked, color: 'b60205', description: 'The pipeline gave up — a human is needed' },
];

export const ensureAllLabels = () => gh.ensureLabels(LABEL_SPECS);

/* ------------------------------ task issues ------------------------------ */

export function taskBody({ order, description, acceptance_criteria = [], files = [], requirements = [], briefNumber }) {
  return [
    `<!-- codenevis:task order=${order} -->`,
    '',
    description.trim(),
    '',
    '## Acceptance criteria',
    ...acceptance_criteria.map((c) => `- [ ] ${c}`),
    files.length ? `\n## Expected files\n${files.map((f) => `- \`${f}\``).join('\n')}` : '',
    requirements.length ? `\n## Implements\n${requirements.join(', ')}` : '',
    '',
    '---',
    briefNumber ? `Planned from brief #${briefNumber} by the PO agent.` : '',
    'The developer agent picks this up automatically; the QC agent reviews the resulting pull request.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function taskOrder(issue) {
  const m = /<!--\s*codenevis:task order=(\d+)/.exec(issue.body ?? '');
  if (m) return Number(m[1]);
  const t = /^\[T(\d+)\]/.exec(issue.title ?? '');
  return t ? Number(t[1]) : Number.MAX_SAFE_INTEGER;
}

export function acceptanceCriteria(issue) {
  const section = /## Acceptance criteria\s*\n([\s\S]*?)(?:\n## |\n---|$)/.exec(issue.body ?? '');
  if (!section) return [];
  return section[1]
    .split('\n')
    .map((l) => l.replace(/^\s*-\s*\[[ xX]\]\s*/, '').trim())
    .filter(Boolean);
}

/** The next task the developer agent should pick up, or null when the backlog is clear. */
export async function nextTask() {
  const issues = (await gh.listIssues({ labels: LABELS.task, state: 'open' })) ?? [];
  const candidates = issues.filter(
    (i) => !i.pull_request && !i.labels.some((l) => (l.name ?? l) === LABELS.blocked)
  );
  candidates.sort((a, b) => taskOrder(a) - taskOrder(b) || a.number - b.number);
  return candidates[0] ?? null;
}

export function branchFor(issue) {
  const slug = (issue.title ?? '')
    .replace(/^\[T\d+\]\s*/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return `task/${issue.number}${slug ? `-${slug}` : ''}`;
}

/** How many times QC has already bounced this task. */
export async function qcRounds(issueNumber) {
  const comments = (await gh.listIssueComments(issueNumber)) ?? [];
  return comments.filter((c) => (c.body ?? '').includes('<!-- codenevis:qc-changes -->')).length;
}

/* --------------------------------- git ----------------------------------- */

export function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: opts.quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
    ...opts,
  });
}

export function configureGitIdentity(name = 'codenevis-agent', email = 'codenevis-agent@users.noreply.github.com') {
  git(['config', 'user.name', name]);
  git(['config', 'user.email', email]);
}

/** Stage everything and commit. Returns false when the tree was already clean. */
export function gitCommitAll(message) {
  configureGitIdentity();
  git(['add', '-A']);
  const status = git(['status', '--porcelain'], { quiet: true }).trim();
  if (!status) return false;
  execFileSync('git', ['commit', '-m', message], { cwd: REPO_ROOT, stdio: 'inherit' });
  return true;
}

export function changedFiles(baseRef) {
  try {
    return git(['diff', '--name-only', `${baseRef}...HEAD`], { quiet: true })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
