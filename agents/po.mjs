#!/usr/bin/env node
/**
 * Product Owner agent.
 *
 * Input : a GitHub issue describing what the human wants (BRIEF_ISSUE).
 * Output: docs/PRD.md + docs/ARCHITECTURE.md committed to the base branch,
 *         and one GitHub issue per backlog task, labelled for the dev agent.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { loadAgent, loadPolicy, describeAgent, REPO_ROOT } from './lib/config.mjs';
import { Workspace, buildTools } from './lib/tools.mjs';
import { runAgent } from './lib/runner.mjs';
import * as gh from './lib/github.mjs';
import { LABELS, ensureAllLabels, taskBody, gitCommitAll } from './lib/pipeline.mjs';

const briefNumber = Number(process.env.BRIEF_ISSUE);
if (!Number.isInteger(briefNumber) || briefNumber <= 0) {
  console.error('BRIEF_ISSUE must be the number of the issue holding the project brief');
  process.exit(1);
}

const agent = loadAgent('po');
const policy = loadPolicy();
console.log(describeAgent(agent));

await ensureAllLabels();

const brief = await gh.getIssue(briefNumber);
console.log(`brief: #${brief.number} "${brief.title}"`);

const existingTasks = (await gh.listIssues({ labels: LABELS.task, state: 'all' })) ?? [];
if (existingTasks.length) {
  console.log(`note: ${existingTasks.length} task issue(s) already exist — planning will extend them`);
}

const ws = new Workspace(REPO_ROOT);
const tasks = [];

const planningTools = [
  {
    name: 'create_task',
    description:
      'Add one task to the backlog. Call once per task, in the order the tasks must be executed.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Imperative one-line title, e.g. "Add the /todos REST endpoints".',
        },
        description: {
          type: 'string',
          description:
            'What to build and why, in enough detail that a developer needs no further context. Markdown.',
        },
        acceptance_criteria: {
          type: 'array',
          items: { type: 'string' },
          description: 'Concrete, checkable conditions. Each one verifiable from the code or the test run.',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files this task is expected to create or change.',
        },
        requirements: {
          type: 'array',
          items: { type: 'string' },
          description: 'PRD requirement ids this task implements, e.g. ["FR-1","FR-3"].',
        },
      },
      required: ['title', 'description', 'acceptance_criteria'],
    },
    run: (input) => {
      if (!input.acceptance_criteria?.length) {
        return 'a task needs at least one acceptance criterion — call create_task again with them';
      }
      tasks.push(input);
      return `task ${tasks.length} queued: ${input.title}`;
    },
  },
  {
    name: 'finish',
    terminal: true,
    description: 'Call once the PRD, the architecture note, and every task are done.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Two or three sentences for the human who filed the brief.' },
      },
      required: ['summary'],
    },
    run: ({ summary }) => `recorded: ${summary}`,
  },
];

const system = fs.readFileSync(path.join(REPO_ROOT, 'agents/prompts/po.md'), 'utf8');

const task = [
  `# Project brief (GitHub issue #${brief.number})`,
  '',
  `## Title`,
  brief.title,
  '',
  `## Description`,
  brief.body?.trim() || '(the issue body was empty — infer a reasonable minimal product from the title)',
  '',
  existingTasks.length
    ? `## Note\nThe backlog already contains ${existingTasks.length} task(s). Read the repository first and plan work that extends what exists.`
    : '',
  '',
  'Produce docs/PRD.md and docs/ARCHITECTURE.md, then create the backlog with create_task, then call finish.',
].join('\n');

const { result, text, usage } = await runAgent({
  agent,
  system,
  task,
  tools: buildTools(ws, { shell: false, extra: planningTools }),
  name: 'po',
});

if (!tasks.length) {
  await gh.commentOnIssue(
    briefNumber,
    `### PO agent failed\n\nNo tasks were produced. Model output:\n\n> ${(text || '(empty)').slice(0, 1500)}`
  );
  throw new Error('the PO agent produced no tasks');
}

/* ---- commit the planning documents ------------------------------------- */

const committed = gitCommitAll(
  `docs: PRD and backlog for "${brief.title}" (closes planning for #${brief.number})`
);
if (committed) {
  execFileSync('git', ['push', 'origin', `HEAD:${policy.baseBranch}`], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  console.log('planning documents pushed');
} else {
  console.log('no document changes to commit');
}

/* ---- create the task issues -------------------------------------------- */

const created = [];
for (const [index, t] of tasks.entries()) {
  const order = existingTasks.length + index + 1;
  const issue = await gh.createIssue({
    title: `[T${String(order).padStart(2, '0')}] ${t.title}`,
    body: taskBody({ ...t, order, briefNumber }),
    labels: [LABELS.task, LABELS.dev, LABELS.todo],
  });
  created.push(issue);
  console.log(`created #${issue.number}: ${issue.title}`);
}

const list = created.map((i) => `- #${i.number} — ${i.title}`).join('\n');

await gh.commentOnIssue(
  briefNumber,
  [
    '### PO agent — planning complete',
    '',
    result?.summary ?? text ?? '',
    '',
    `**Backlog (${created.length} tasks)**`,
    list,
    '',
    `Documents: [\`docs/PRD.md\`](../blob/${policy.baseBranch}/docs/PRD.md) · [\`docs/ARCHITECTURE.md\`](../blob/${policy.baseBranch}/docs/ARCHITECTURE.md)`,
    '',
    `<sub>${agent.provider}/${agent.model} · ${usage.steps} steps · ${usage.input}+${usage.output} tokens</sub>`,
  ].join('\n')
);

await gh.addLabels(briefNumber, [LABELS.brief, LABELS.poDone]);

gh.summaryLine(`## PO agent\n\nBrief #${briefNumber} → ${created.length} tasks\n\n${list}`);
gh.setOutput('task_count', created.length);
gh.setOutput('first_task', created[0]?.number ?? '');
