#!/usr/bin/env node
/**
 * Developer agent.
 *
 * Input : TASK_ISSUE — a backlog issue created by the PO agent.
 * Output: a branch with the implementation and an open pull request that
 *         closes the issue, handed to the QC agent.
 *
 * Re-running it on a task QC sent back reuses the same branch and pull
 * request, so the review conversation stays in one place.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { loadAgent, loadPolicy, describeAgent, REPO_ROOT } from './lib/config.mjs';
import { Workspace, buildTools } from './lib/tools.mjs';
import { runAgent } from './lib/runner.mjs';
import * as gh from './lib/github.mjs';
import {
  LABELS,
  ensureAllLabels,
  acceptanceCriteria,
  branchFor,
  git,
  gitCommitAll,
  changedFiles,
} from './lib/pipeline.mjs';

const issueNumber = Number(process.env.TASK_ISSUE);
if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
  console.error('TASK_ISSUE must be the number of the task issue to implement');
  process.exit(1);
}

const agent = loadAgent('dev');
const policy = loadPolicy();
console.log(describeAgent(agent));

await ensureAllLabels();

const issue = await gh.getIssue(issueNumber);
if (issue.state !== 'open') {
  console.log(`#${issueNumber} is already closed — nothing to do`);
  process.exit(0);
}
console.log(`task: #${issue.number} "${issue.title}"`);

const branch = branchFor(issue);
const base = policy.baseBranch;

/* ---- branch: reuse the review branch if one exists ---------------------- */

git(['fetch', 'origin', '--prune']);
const remoteBranches = git(['branch', '-r'], { quiet: true });
const reusing = remoteBranches.includes(`origin/${branch}`);

if (reusing) {
  console.log(`reusing existing branch ${branch}`);
  git(['checkout', '-B', branch, `origin/${branch}`]);
} else {
  git(['checkout', '-B', branch, `origin/${base}`]);
}

/* ---- gather QC feedback, if this is a re-run ---------------------------- */

const comments = (await gh.listIssueComments(issueNumber)) ?? [];
const feedback = comments
  .filter((c) => (c.body ?? '').includes('<!-- codenevis:qc-changes -->'))
  .map((c) => c.body);
const latestFeedback = feedback.at(-1);

/* ---- run the agent ------------------------------------------------------ */

await gh.removeLabel(issueNumber, LABELS.todo);
await gh.removeLabel(issueNumber, LABELS.changes);
await gh.addLabels(issueNumber, [LABELS.inProgress]);

const ws = new Workspace(REPO_ROOT);
let summary = '';

const finishTool = {
  name: 'finish',
  terminal: true,
  description: 'Call when the task is implemented, the tests pass, and you are done.',
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'What you changed and why, in markdown. Written for the reviewer.',
      },
      test_command: { type: 'string', description: 'The exact command you ran to verify the work.' },
      tests_passed: { type: 'boolean', description: 'Whether that command exited successfully.' },
      notes: {
        type: 'string',
        description: 'Anything the reviewer should look at closely, or out-of-scope problems you noticed.',
      },
    },
    required: ['summary', 'tests_passed'],
  },
  run: (input) => {
    summary = input.summary;
    return 'recorded';
  },
};

const system = fs.readFileSync(path.join(REPO_ROOT, 'agents/prompts/dev.md'), 'utf8');
const criteria = acceptanceCriteria(issue);

const prompt = [
  `# Task #${issue.number}: ${issue.title}`,
  '',
  issue.body?.trim() ?? '',
  '',
  criteria.length ? `## Acceptance criteria you must satisfy\n${criteria.map((c) => `- ${c}`).join('\n')}` : '',
  '',
  latestFeedback
    ? [
        '## QC returned this task — address every point',
        '',
        latestFeedback.replace('<!-- codenevis:qc-changes -->', '').trim(),
        '',
        'Your previous implementation is already on this branch. Fix it in place rather than starting over.',
      ].join('\n')
    : '',
  '',
  `You are on branch \`${branch}\`, branched from \`${base}\`. Implement the task, write and run the tests, then call finish.`,
].join('\n');

const { result, text, usage } = await runAgent({
  agent,
  system,
  task: prompt,
  tools: buildTools(ws, { shell: true, extra: [finishTool] }),
  name: 'dev',
});

summary = summary || text || '(the developer agent produced no summary)';

/* ---- commit and push ---------------------------------------------------- */

const commitMessage = [
  `${issue.title.replace(/^\[T\d+\]\s*/, '')}`,
  '',
  `Implements #${issue.number}.`,
  '',
  summary.slice(0, 1500),
].join('\n');

const didCommit = gitCommitAll(commitMessage);
const touched = changedFiles(`origin/${base}`);

if (!didCommit && !reusing) {
  await gh.removeLabel(issueNumber, LABELS.inProgress);
  await gh.addLabels(issueNumber, [LABELS.blocked]);
  await gh.commentOnIssue(
    issueNumber,
    `### Developer agent produced no changes\n\nThe run finished without touching any file, so there is nothing to review.\n\n> ${(text || '(no output)').slice(0, 1500)}\n\nLabelled \`${LABELS.blocked}\` — the pipeline will skip this task until a human looks at it.`
  );
  throw new Error('the developer agent made no changes');
}

execFileSync('git', ['push', '--force-with-lease', 'origin', `HEAD:${branch}`], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
});
console.log(`pushed ${branch}`);

/* ---- open or update the pull request ------------------------------------ */

const openPRs = (await gh.listOpenPRs()) ?? [];
let pr = openPRs.find((p) => p.head.ref === branch);

const prBody = [
  `Closes #${issue.number}`,
  '',
  '## What changed',
  summary,
  '',
  result?.test_command
    ? `## Verification\n\`\`\`\n${result.test_command}\n\`\`\`\n${result.tests_passed ? 'Passing.' : '**Failing — see the notes below.**'}`
    : '',
  result?.notes ? `\n## Notes for the reviewer\n${result.notes}` : '',
  touched.length ? `\n## Files\n${touched.map((f) => `- \`${f}\``).join('\n')}` : '',
  '',
  '---',
  `<sub>Written by the developer agent · ${agent.provider}/${agent.model} · ${usage.steps} steps · ${usage.input}+${usage.output} tokens</sub>`,
]
  .filter(Boolean)
  .join('\n');

if (pr) {
  console.log(`updating existing PR #${pr.number}`);
  await gh.commentOnIssue(pr.number, `### Developer agent — revision pushed\n\n${summary}`);
} else {
  pr = await gh.createPR({
    title: issue.title.replace(/^\[T(\d+)\]/, 'T$1:'),
    head: branch,
    base,
    body: prBody,
  });
  console.log(`opened PR #${pr.number}`);
}

await gh.addLabels(pr.number, [LABELS.qc, LABELS.review]);
await gh.removeLabel(issueNumber, LABELS.inProgress);
await gh.addLabels(issueNumber, [LABELS.review]);

if (result && result.tests_passed === false) {
  await gh.commentOnIssue(
    pr.number,
    `> The developer agent reported that the test command did **not** pass. QC should treat this as a blocker unless the failure is unrelated to this task.`
  );
}

gh.summaryLine(`## Developer agent\n\nTask #${issue.number} → PR #${pr.number} on \`${branch}\``);
gh.setOutput('pr_number', pr.number);
gh.setOutput('branch', branch);
