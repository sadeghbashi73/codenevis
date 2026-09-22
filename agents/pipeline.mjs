#!/usr/bin/env node
/**
 * The orchestrator.
 *
 * Runs the whole loop inside a single GitHub Actions job:
 *
 *   brief issue -> PO plans -> for each task: dev implements
 *                                             -> QC reviews
 *                                             -> merge or send back
 *                                          -> next task
 *
 * Keeping the loop in one job is deliberate: GITHUB_TOKEN cannot trigger
 * another workflow run, so a chain of workflows would need a personal access
 * token just to keep moving. This needs none.
 *
 * Inputs (environment):
 *   BRIEF_ISSUE  the project brief to plan, when planning is needed
 *   MAX_TASKS    how many tasks to attempt in this run
 *   SKIP_PO      "true" to go straight to the existing backlog
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPolicy, REPO_ROOT } from './lib/config.mjs';
import * as gh from './lib/github.mjs';
import { LABELS, ensureAllLabels, nextTask, branchFor, git } from './lib/pipeline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const policy = loadPolicy();

const briefIssue = Number(process.env.BRIEF_ISSUE) || null;
const skipPO = process.env.SKIP_PO === 'true';
const maxTasks = Number(process.env.MAX_TASKS) || policy.maxTasksPerRun;

/** Run one agent in its own process so a crash cannot poison the loop. */
function runStage(script, env, label) {
  console.log(`\n${'='.repeat(70)}\n  ${label}\n${'='.repeat(70)}\n`);
  const res = spawnSync(process.execPath, [path.join(HERE, script)], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  return res.status === 0;
}

await ensureAllLabels();

const log = [];

/* ---- 1. planning -------------------------------------------------------- */

if (briefIssue && !skipPO) {
  const brief = await gh.getIssue(briefIssue);
  const planned = brief.labels.some((l) => (l.name ?? l) === LABELS.poDone);

  if (planned) {
    console.log(`brief #${briefIssue} is already planned — going to the backlog`);
  } else {
    const ok = runStage('po.mjs', { BRIEF_ISSUE: String(briefIssue) }, `PO agent — planning brief #${briefIssue}`);
    if (!ok) {
      gh.summaryLine('## Pipeline halted\n\nThe PO agent failed. See the log above.');
      process.exit(1);
    }
    log.push(`Planned brief #${briefIssue}.`);
    // Planning pushed docs to the base branch; pick them up before building.
    git(['fetch', 'origin', '--prune']);
    git(['checkout', policy.baseBranch]);
    git(['reset', '--hard', `origin/${policy.baseBranch}`]);
  }
}

/* ---- 2. the task loop --------------------------------------------------- */

let completed = 0;
let attempted = 0;

while (attempted < maxTasks) {
  const task = await nextTask();
  if (!task) {
    console.log('\nbacklog is clear');
    break;
  }

  attempted++;
  console.log(`\n### task ${attempted}/${maxTasks}: #${task.number} ${task.title}`);

  // Always build on top of the latest base branch.
  git(['fetch', 'origin', '--prune']);
  git(['checkout', '-B', policy.baseBranch, `origin/${policy.baseBranch}`]);

  const devOk = runStage('dev.mjs', { TASK_ISSUE: String(task.number) }, `Developer agent — task #${task.number}`);
  if (!devOk) {
    log.push(`Task #${task.number}: the developer agent failed — left for a human.`);
    await gh.addLabels(task.number, [LABELS.blocked]).catch(() => {});
    continue;
  }

  const branch = branchFor(task);
  const openPRs = (await gh.listOpenPRs()) ?? [];
  const pr = openPRs.find((p) => p.head.ref === branch);
  if (!pr) {
    log.push(`Task #${task.number}: no pull request was opened — left for a human.`);
    await gh.addLabels(task.number, [LABELS.blocked]).catch(() => {});
    continue;
  }

  // Review, and give the developer another go while QC keeps sending it back.
  let merged = false;
  for (let roundIndex = 0; roundIndex < policy.maxQcRounds; roundIndex++) {
    git(['fetch', 'origin', '--prune']);
    git(['checkout', '-B', branch, `origin/${branch}`]);

    const qcOk = runStage('qc.mjs', { PR_NUMBER: String(pr.number) }, `QC agent — PR #${pr.number} (round ${roundIndex + 1})`);
    if (!qcOk) {
      log.push(`Task #${task.number}: the QC agent failed on PR #${pr.number}.`);
      break;
    }

    const state = await gh.getPR(pr.number);
    if (state.merged) {
      merged = true;
      break;
    }

    const blocked = state.labels.some((l) => (l.name ?? l) === LABELS.blocked);
    if (blocked) {
      log.push(`Task #${task.number}: QC blocked it after ${policy.maxQcRounds} rounds — needs a human.`);
      break;
    }

    // QC asked for changes: hand it back to the developer on the same branch.
    const retryOk = runStage(
      'dev.mjs',
      { TASK_ISSUE: String(task.number) },
      `Developer agent — revision for task #${task.number}`
    );
    if (!retryOk) {
      log.push(`Task #${task.number}: the developer agent failed on the revision.`);
      break;
    }
  }

  if (merged) {
    completed++;
    log.push(`Task #${task.number} merged via PR #${pr.number}.`);
    console.log(`task #${task.number} done`);
  } else {
    // Do not spin on a task that will not converge.
    await gh.addLabels(task.number, [LABELS.blocked]).catch(() => {});
    log.push(`Task #${task.number}: not merged — labelled \`${LABELS.blocked}\`.`);
  }
}

/* ---- 3. report ---------------------------------------------------------- */

const remaining = await nextTask();

const report = [
  '## Pipeline run',
  '',
  ...log.map((l) => `- ${l}`),
  '',
  `**${completed} task(s) merged** out of ${attempted} attempted.`,
  remaining
    ? `Next up: #${remaining.number} — ${remaining.title}. Run the pipeline again to continue.`
    : 'The backlog is clear.',
].join('\n');

console.log(`\n${report}`);
gh.summaryLine(report);

if (briefIssue) {
  await gh.commentOnIssue(briefIssue, report).catch((err) => console.log(`could not comment: ${err.message}`));
}

gh.setOutput('completed', completed);
gh.setOutput('remaining', remaining ? remaining.number : '');
