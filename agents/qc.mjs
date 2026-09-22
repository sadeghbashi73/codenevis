#!/usr/bin/env node
/**
 * QC agent.
 *
 * Input : PR_NUMBER — a pull request opened by the developer agent.
 * Output: either a merge (task closed, pipeline moves on) or a change request
 *         sent back to the developer agent with specific findings.
 *
 * After `policy.maxQcRounds` unsuccessful rounds the task is labelled
 * `needs:human` and the pipeline stops touching it, rather than burning
 * tokens on a loop that is not converging.
 */

import fs from 'node:fs';
import path from 'node:path';

import { loadAgent, loadPolicy, describeAgent, REPO_ROOT } from './lib/config.mjs';
import { Workspace, buildTools } from './lib/tools.mjs';
import { runAgent } from './lib/runner.mjs';
import * as gh from './lib/github.mjs';
import { LABELS, ensureAllLabels, acceptanceCriteria, qcRounds } from './lib/pipeline.mjs';

const prNumber = Number(process.env.PR_NUMBER);
if (!Number.isInteger(prNumber) || prNumber <= 0) {
  console.error('PR_NUMBER must be the number of the pull request to review');
  process.exit(1);
}

const agent = loadAgent('qc');
const policy = loadPolicy();
console.log(describeAgent(agent));

await ensureAllLabels();

const pr = await gh.getPR(prNumber);
if (pr.state !== 'open') {
  console.log(`PR #${prNumber} is ${pr.state} — nothing to review`);
  process.exit(0);
}

const linked = /(?:closes|fixes|resolves)\s+#(\d+)/i.exec(pr.body ?? '');
const taskNumber = linked ? Number(linked[1]) : null;
const task = taskNumber ? await gh.getIssue(taskNumber) : null;

console.log(`reviewing PR #${pr.number} "${pr.title}"${task ? ` for task #${task.number}` : ''}`);

const round = taskNumber ? await qcRounds(taskNumber) : 0;
console.log(`QC round ${round + 1} of ${policy.maxQcRounds}`);

/* ---- assemble the review context ---------------------------------------- */

const diff = await gh.getPRDiff(prNumber);
const files = (await gh.listPRFiles(prNumber)) ?? [];

const PIPELINE_PATHS = /^(\.github\/workflows\/|agents\/|config\/agents\.json$)/;
const pipelineEdits = files.map((f) => f.filename).filter((f) => PIPELINE_PATHS.test(f));

const MAX_DIFF = 120_000;
const diffForReview =
  diff.length > MAX_DIFF
    ? `${diff.slice(0, MAX_DIFF)}\n\n...[diff truncated at ${MAX_DIFF} characters — use read_file to inspect the rest]`
    : diff;

/* ---- run the agent ------------------------------------------------------ */

const ws = new Workspace(REPO_ROOT, { readOnly: true });
let verdict = null;

const verdictTool = {
  name: 'verdict',
  terminal: true,
  description: 'Deliver the review decision. Call this exactly once, at the end of the review.',
  parameters: {
    type: 'object',
    properties: {
      decision: {
        type: 'string',
        enum: ['approve', 'request_changes'],
        description: 'approve merges the pull request; request_changes sends it back to the developer agent.',
      },
      summary: {
        type: 'string',
        description: 'A short paragraph explaining the decision.',
      },
      criteria_met: {
        type: 'boolean',
        description: 'Whether every acceptance criterion is satisfied.',
      },
      tests_run: {
        type: 'string',
        description: 'The test command you executed and its result. Say so plainly if you could not run one.',
      },
      findings: {
        type: 'array',
        description: 'Blocking problems. Empty when approving.',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            location: { type: 'string', description: 'Line number, function, or section.' },
            problem: { type: 'string', description: 'What is wrong and why it matters.' },
            fix: { type: 'string', description: 'The concrete change that would resolve it.' },
            severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          },
          required: ['file', 'problem', 'fix'],
        },
      },
      notes: {
        type: 'string',
        description: 'Non-blocking observations. These never prevent a merge.',
      },
    },
    required: ['decision', 'summary'],
  },
  run: (input) => {
    verdict = input;
    return `verdict recorded: ${input.decision}`;
  },
};

const system = fs.readFileSync(path.join(REPO_ROOT, 'agents/prompts/qc.md'), 'utf8');
const criteria = task ? acceptanceCriteria(task) : [];

const prompt = [
  `# Review pull request #${pr.number}: ${pr.title}`,
  '',
  task ? `## Task #${task.number}: ${task.title}\n\n${task.body ?? ''}` : '_(no linked task issue — review against the PR description)_',
  '',
  criteria.length ? `## Acceptance criteria\n${criteria.map((c) => `- ${c}`).join('\n')}` : '',
  '',
  '## The developer agent said',
  pr.body ?? '(no description)',
  '',
  pipelineEdits.length
    ? `## WARNING\nThis pull request modifies the pipeline itself: ${pipelineEdits.join(', ')}. That is never allowed. Request changes.`
    : '',
  '',
  `## Changed files (${files.length})`,
  files.map((f) => `- ${f.filename} (+${f.additions}/-${f.deletions})`).join('\n'),
  '',
  '## Diff',
  '```diff',
  diffForReview,
  '```',
  '',
  `The repository is checked out at this pull request's head. Read the code, run the tests with the \`run\` tool, then call \`verdict\`.`,
  round > 0
    ? `\nThis is review round ${round + 1}. After ${policy.maxQcRounds} rounds the task is escalated to a human, so if the remaining problems are minor, approve and note them instead of blocking.`
    : '',
].join('\n');

const { text, usage } = await runAgent({
  agent,
  system,
  task: prompt,
  tools: buildTools(ws, { shell: true, extra: [verdictTool] }),
  name: 'qc',
});

if (!verdict) {
  verdict = {
    decision: 'request_changes',
    summary: `The QC agent finished without delivering a verdict. Raw output:\n\n> ${(text || '(empty)').slice(0, 1000)}`,
    findings: [],
  };
}

/* ---- pipeline edits are a hard block, whatever the model decided -------- */

if (pipelineEdits.length) {
  verdict.decision = 'request_changes';
  verdict.findings = [
    ...(verdict.findings ?? []),
    {
      file: pipelineEdits.join(', '),
      problem: 'The pull request modifies the agent pipeline itself, which is off limits to task work.',
      fix: 'Revert every change under .github/workflows/, agents/, and config/agents.json.',
      severity: 'blocker',
    },
  ];
}

const findings = verdict.findings ?? [];
const footer = `<sub>Reviewed by the QC agent · ${agent.provider}/${agent.model} · ${usage.steps} steps · ${usage.input}+${usage.output} tokens</sub>`;

/* ---- approve ------------------------------------------------------------ */

if (verdict.decision === 'approve') {
  const body = [
    '### QC agent — approved',
    '',
    verdict.summary,
    verdict.tests_run ? `\n**Verification:** ${verdict.tests_run}` : '',
    verdict.notes ? `\n**Non-blocking notes**\n\n${verdict.notes}` : '',
    '',
    footer,
  ]
    .filter(Boolean)
    .join('\n');

  await gh.createReview(prNumber, { event: 'APPROVE', body });

  if (policy.autoMerge) {
    await gh.mergePR(prNumber, { title: `${pr.title} (#${pr.number})` });
    console.log(`merged PR #${prNumber}`);
    await gh.deleteBranch(pr.head.ref);

    if (taskNumber) {
      await gh.removeLabel(taskNumber, LABELS.review);
      await gh.removeLabel(taskNumber, LABELS.qc);
      await gh.addLabels(taskNumber, [LABELS.done]);
      await gh.closeIssue(taskNumber);
    }
  } else {
    console.log('autoMerge is off — the pull request is approved and left open');
  }

  gh.summaryLine(`## QC agent\n\nPR #${prNumber} **approved**${policy.autoMerge ? ' and merged' : ''}.`);
  gh.setOutput('decision', 'approved');
  process.exit(0);
}

/* ---- request changes ---------------------------------------------------- */

const findingList = findings.length
  ? findings
      .map(
        (f, i) =>
          `**${i + 1}. \`${f.file}\`${f.location ? ` — ${f.location}` : ''}**${f.severity ? ` _(${f.severity})_` : ''}\n\n${f.problem}\n\n_Fix:_ ${f.fix}`
      )
      .join('\n\n')
  : '_(no structured findings were provided)_';

const exhausted = round + 1 >= policy.maxQcRounds;

const body = [
  '<!-- codenevis:qc-changes -->',
  `### QC agent — changes requested (round ${round + 1}/${policy.maxQcRounds})`,
  '',
  verdict.summary,
  verdict.tests_run ? `\n**Verification:** ${verdict.tests_run}` : '',
  '',
  '#### Findings',
  '',
  findingList,
  verdict.notes ? `\n#### Non-blocking notes\n\n${verdict.notes}` : '',
  '',
  exhausted
    ? `> The review budget for this task is spent. It is now labelled \`${LABELS.blocked}\` and the pipeline will move on. A human needs to take it from here.`
    : '> The developer agent will pick this up and push a revision to the same branch.',
  '',
  footer,
]
  .filter(Boolean)
  .join('\n');

await gh.createReview(prNumber, { event: 'REQUEST_CHANGES', body });

if (taskNumber) {
  await gh.commentOnIssue(taskNumber, body);
  await gh.removeLabel(taskNumber, LABELS.review);
  if (exhausted) {
    await gh.addLabels(taskNumber, [LABELS.blocked]);
  } else {
    await gh.addLabels(taskNumber, [LABELS.dev, LABELS.changes]);
  }
}

await gh.removeLabel(prNumber, LABELS.qc);
await gh.addLabels(prNumber, exhausted ? [LABELS.blocked] : [LABELS.dev, LABELS.changes]);

gh.summaryLine(
  `## QC agent\n\nPR #${prNumber} **changes requested** (round ${round + 1}/${policy.maxQcRounds})${exhausted ? ' — escalated to a human' : ''}.\n\n${findings.length} finding(s).`
);
gh.setOutput('decision', exhausted ? 'blocked' : 'changes_requested');
