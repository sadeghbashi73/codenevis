/**
 * Resolves the per-agent configuration.
 *
 * Precedence, highest first:
 *   1. environment override  (PO_MODEL, DEV_PROVIDER, QC_BASE_URL, ...)
 *   2. config/agents.json    (committed, reviewable)
 *   3. built-in defaults
 *
 * API keys NEVER live in the config file. The file only names the *secret*
 * that holds the key (`apiKeyEnv`), and the value arrives through the
 * workflow environment from GitHub repository secrets.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = process.env.CODENEVIS_ROOT || path.resolve(HERE, '..', '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'config', 'agents.json');

const BUILT_IN = {
  defaults: {
    provider: 'anthropic',
    temperature: 0.2,
    maxTokens: 8192,
    maxSteps: 40,
  },
  agents: {
    po: { model: 'claude-opus-5', apiKeyEnv: 'PO_API_KEY', maxSteps: 30 },
    dev: { model: 'claude-opus-5', apiKeyEnv: 'DEV_API_KEY', maxSteps: 80 },
    qc: { model: 'claude-sonnet-5', apiKeyEnv: 'QC_API_KEY', maxSteps: 50 },
  },
  policy: {
    maxQcRounds: 3,
    autoMerge: true,
    maxTasksPerRun: 10,
    baseBranch: 'main',
  },
};

function readConfigFile() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`config/agents.json is not valid JSON: ${err.message}`);
  }
}

export function loadPolicy() {
  const file = readConfigFile();
  return { ...BUILT_IN.policy, ...(file.policy ?? {}) };
}

/**
 * @param {'po'|'dev'|'qc'} role
 * @returns {{role:string, model:string, provider:string, apiKey:string, baseUrl?:string, maxSteps:number, temperature:number, maxTokens:number}}
 */
export function loadAgent(role) {
  const file = readConfigFile();
  const defaults = { ...BUILT_IN.defaults, ...(file.defaults ?? {}) };
  const fromFile = { ...(BUILT_IN.agents[role] ?? {}), ...(file.agents?.[role] ?? {}) };
  const R = role.toUpperCase();

  const cfg = {
    role,
    provider: process.env[`${R}_PROVIDER`] || fromFile.provider || defaults.provider,
    model: process.env[`${R}_MODEL`] || fromFile.model || defaults.model,
    baseUrl: process.env[`${R}_BASE_URL`] || fromFile.baseUrl || defaults.baseUrl,
    temperature: num(process.env[`${R}_TEMPERATURE`], fromFile.temperature ?? defaults.temperature),
    maxTokens: num(process.env[`${R}_MAX_TOKENS`], fromFile.maxTokens ?? defaults.maxTokens),
    maxSteps: num(process.env[`${R}_MAX_STEPS`], fromFile.maxSteps ?? defaults.maxSteps),
    apiKeyEnv: fromFile.apiKeyEnv || `${R}_API_KEY`,
  };

  // Each agent gets its own key. Fall back to a shared key only if the
  // dedicated one is absent, so a single-key setup still works.
  cfg.apiKey = process.env[cfg.apiKeyEnv] || process.env.CODENEVIS_API_KEY || '';

  if (!cfg.apiKey) {
    throw new Error(
      `No API key for the "${role}" agent.\n` +
        `Add a repository secret named ${cfg.apiKeyEnv} (Settings -> Secrets and variables -> Actions),\n` +
        `or set CODENEVIS_API_KEY to use one key for every agent.`
    );
  }
  if (!cfg.model) throw new Error(`No model configured for the "${role}" agent.`);

  return cfg;
}

function num(envValue, fallback) {
  if (envValue === undefined || envValue === '') return fallback;
  const n = Number(envValue);
  return Number.isFinite(n) ? n : fallback;
}

export function describeAgent(cfg) {
  return `${cfg.role} | ${cfg.provider}/${cfg.model} | key from ${cfg.apiKeyEnv} | ${cfg.maxSteps} steps`;
}
