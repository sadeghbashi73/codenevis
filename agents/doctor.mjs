#!/usr/bin/env node
/**
 * Configuration check.
 *
 * Prints what each agent is wired to and whether its key is present, without
 * ever printing the key itself. Run it locally before pushing, and it also
 * runs as the first step of the pipeline so a missing secret fails fast with a
 * readable message instead of a stack trace forty minutes in.
 */

import { loadAgent, loadPolicy } from './lib/config.mjs';

const ROLES = ['po', 'dev', 'qc'];
let problems = 0;

console.log('codenevis — agent configuration\n');

for (const role of ROLES) {
  try {
    const cfg = loadAgent(role);
    const shared = !process.env[cfg.apiKeyEnv] && process.env.CODENEVIS_API_KEY;
    console.log(
      `  ${role.toUpperCase().padEnd(4)} ${cfg.provider}/${cfg.model}` +
        `\n       key      ${shared ? 'CODENEVIS_API_KEY (shared fallback)' : cfg.apiKeyEnv} — present` +
        `\n       budget   ${cfg.maxSteps} steps, ${cfg.maxTokens} max tokens, temperature ${cfg.temperature}` +
        (cfg.baseUrl ? `\n       endpoint ${cfg.baseUrl}` : '') +
        '\n'
    );
  } catch (err) {
    problems++;
    console.log(`  ${role.toUpperCase().padEnd(4)} NOT CONFIGURED\n       ${err.message.split('\n').join('\n       ')}\n`);
  }
}

const policy = loadPolicy();
console.log('policy');
console.log(`  base branch        ${policy.baseBranch}`);
console.log(`  QC rounds per task ${policy.maxQcRounds}`);
console.log(`  auto-merge         ${policy.autoMerge}`);
console.log(`  tasks per run      ${policy.maxTasksPerRun}\n`);

const token = process.env.GH_PAT ? 'GH_PAT' : process.env.GITHUB_TOKEN ? 'GITHUB_TOKEN' : null;
console.log(`github token         ${token ?? 'MISSING'}`);
console.log(`repository           ${process.env.GITHUB_REPOSITORY ?? '(not running in Actions)'}\n`);

if (problems) {
  console.error(
    `${problems} agent(s) are not configured.\n` +
      'Add the missing repository secrets under Settings -> Secrets and variables -> Actions.'
  );
  process.exit(1);
}

console.log('All three agents are configured.');
