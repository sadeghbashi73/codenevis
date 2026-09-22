/**
 * Tools handed to the agents.
 *
 * Everything is sandboxed to the repository root:
 *   - path traversal outside the repo is rejected
 *   - `protectedPaths` (the pipeline's own code) is read-only for every agent
 *   - shell commands run with the API keys stripped from the environment,
 *     so an agent cannot leak its own key into a commit or a log
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MAX_READ_BYTES = 200_000;
const MAX_OUTPUT_CHARS = 30_000;
const SHELL_TIMEOUT_MS = 10 * 60_000;

const ALWAYS_IGNORED = new Set([
  '.git', 'node_modules', '.next', 'dist', 'build', 'coverage',
  '__pycache__', '.venv', 'venv', '.pytest_cache', 'target', 'vendor',
]);

/** Paths no agent may write to — protects the pipeline from itself. */
export const DEFAULT_PROTECTED = [
  '.github/workflows',
  'agents',
  'config/agents.json',
  '.git',
];

export class Workspace {
  constructor(root, { protectedPaths = DEFAULT_PROTECTED, readOnly = false, allowShell = true } = {}) {
    this.root = path.resolve(root);
    this.protectedPaths = protectedPaths;
    this.readOnly = readOnly;
    this.allowShell = allowShell;
    this.touched = new Set();
  }

  resolve(rel) {
    if (typeof rel !== 'string' || !rel.trim()) throw new Error('path is required');
    const abs = path.resolve(this.root, rel);
    const within = abs === this.root || abs.startsWith(this.root + path.sep);
    if (!within) throw new Error(`path escapes the repository: ${rel}`);
    return abs;
  }

  relative(abs) {
    return path.relative(this.root, abs).split(path.sep).join('/');
  }

  assertWritable(rel) {
    if (this.readOnly) throw new Error('this agent has read-only access to the repository');
    const norm = this.relative(this.resolve(rel));
    for (const p of this.protectedPaths) {
      if (norm === p || norm.startsWith(p.replace(/\/$/, '') + '/')) {
        throw new Error(
          `"${norm}" is part of the agent pipeline itself and is protected. ` +
          `Put your implementation somewhere else in the repository.`
        );
      }
    }
  }

  /** Environment for child processes: ours minus every secret. */
  safeEnv() {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (/API_KEY|_TOKEN$|^GITHUB_TOKEN$|^GH_PAT$|SECRET|PASSWORD/i.test(key)) {
        delete env[key];
      }
    }
    env.CI = 'true';
    return env;
  }
}

const clip = (s, n = MAX_OUTPUT_CHARS) =>
  s.length > n ? `${s.slice(0, n)}\n\n...[truncated, ${s.length - n} more characters]` : s;

function walk(dir, ws, depth, maxDepth, acc) {
  if (depth > maxDepth || acc.length > 4000) return acc;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ALWAYS_IGNORED.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = ws.relative(abs);
    if (entry.isDirectory()) {
      acc.push(`${rel}/`);
      walk(abs, ws, depth + 1, maxDepth, acc);
    } else {
      let size = 0;
      try { size = fs.statSync(abs).size; } catch { /* ignore */ }
      acc.push(`${rel} (${size}b)`);
    }
  }
  return acc;
}

/**
 * Build the tool set for an agent.
 * @param {Workspace} ws
 * @param {{shell?:boolean, extra?:Array}} opts
 */
export function buildTools(ws, { shell = true, extra = [] } = {}) {
  const tools = [
    {
      name: 'list_files',
      description:
        'List files and directories in the repository. Start here to understand the layout before reading or writing anything.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory relative to the repository root. Defaults to the root.' },
          depth: { type: 'integer', description: 'How many levels deep to descend. Default 3.' },
        },
      },
      run: ({ path: p = '.', depth = 3 }) => {
        const abs = ws.resolve(p);
        if (!fs.existsSync(abs)) return `directory not found: ${p}`;
        const listing = walk(abs, ws, 0, Math.min(depth, 6), []);
        return listing.length ? clip(listing.join('\n')) : '(empty)';
      },
    },
    {
      name: 'read_file',
      description: 'Read a UTF-8 text file from the repository. Output is prefixed with line numbers.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to the repository root.' },
        },
        required: ['path'],
      },
      run: ({ path: p }) => {
        const abs = ws.resolve(p);
        if (!fs.existsSync(abs)) return `file not found: ${p}`;
        if (fs.statSync(abs).isDirectory()) return `${p} is a directory - use list_files`;
        if (fs.statSync(abs).size > MAX_READ_BYTES) {
          return `file is larger than ${MAX_READ_BYTES} bytes; read it in pieces with the run tool (sed -n)`;
        }
        const body = fs.readFileSync(abs, 'utf8');
        return body
          .split('\n')
          .map((line, i) => `${String(i + 1).padStart(5)}\t${line}`)
          .join('\n');
      },
    },
    {
      name: 'search',
      description: 'Search file contents across the repository with a regular expression.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regular expression to search for.' },
          path: { type: 'string', description: 'Directory or file to search in. Defaults to the repository root.' },
        },
        required: ['pattern'],
      },
      run: ({ pattern, path: p = '.' }) => {
        const target = ws.resolve(p);
        try {
          const out = execSync(
            `grep -rnI --exclude-dir=.git --exclude-dir=node_modules -E -- ${JSON.stringify(pattern)} ${JSON.stringify(target)}`,
            { cwd: ws.root, encoding: 'utf8', timeout: 60_000, env: ws.safeEnv(), maxBuffer: 20 * 1024 * 1024 }
          );
          return clip(out) || '(no matches)';
        } catch (err) {
          if (err.status === 1) return '(no matches)';
          return `search failed: ${err.message}`;
        }
      },
    },
  ];

  if (!ws.readOnly) {
    tools.push(
      {
        name: 'write_file',
        description:
          'Create a file or replace its entire contents. Parent directories are created automatically. Always write the complete final file.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to the repository root.' },
            content: { type: 'string', description: 'The complete contents of the file.' },
          },
          required: ['path', 'content'],
        },
        run: ({ path: p, content }) => {
          ws.assertWritable(p);
          const abs = ws.resolve(p);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, content ?? '', 'utf8');
          ws.touched.add(ws.relative(abs));
          return `wrote ${ws.relative(abs)} (${Buffer.byteLength(content ?? '')} bytes)`;
        },
      },
      {
        name: 'edit_file',
        description:
          'Replace an exact string inside an existing file. Prefer this over write_file for small changes to large files.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            old_string: { type: 'string', description: 'Exact text to replace. Must appear exactly once unless replace_all is true.' },
            new_string: { type: 'string', description: 'Replacement text.' },
            replace_all: { type: 'boolean', description: 'Replace every occurrence instead of requiring uniqueness.' },
          },
          required: ['path', 'old_string', 'new_string'],
        },
        run: ({ path: p, old_string, new_string, replace_all = false }) => {
          ws.assertWritable(p);
          const abs = ws.resolve(p);
          if (!fs.existsSync(abs)) return `file not found: ${p}`;
          const body = fs.readFileSync(abs, 'utf8');
          const count = body.split(old_string).length - 1;
          if (count === 0) return `old_string not found in ${p} - read the file again and match it exactly`;
          if (count > 1 && !replace_all) {
            return `old_string appears ${count} times in ${p} - add more context or set replace_all`;
          }
          const next = replace_all ? body.split(old_string).join(new_string) : body.replace(old_string, new_string);
          fs.writeFileSync(abs, next, 'utf8');
          ws.touched.add(ws.relative(abs));
          return `edited ${ws.relative(abs)} (${count} replacement${count === 1 ? '' : 's'})`;
        },
      },
      {
        name: 'delete_file',
        description: 'Delete a file from the repository.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
        run: ({ path: p }) => {
          ws.assertWritable(p);
          const abs = ws.resolve(p);
          if (!fs.existsSync(abs)) return `file not found: ${p}`;
          fs.rmSync(abs, { recursive: true, force: true });
          ws.touched.add(ws.relative(abs));
          return `deleted ${ws.relative(abs)}`;
        },
      }
    );
  }

  if (shell && ws.allowShell) {
    tools.push({
      name: 'run',
      description:
        'Run a shell command in the repository root (install dependencies, run tests, run a linter, inspect output). ' +
        'The environment has no API keys or tokens in it. Non-interactive only; there is no TTY.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run.' },
        },
        required: ['command'],
      },
      run: ({ command }) => {
        if (/\bgit\s+(push|commit|remote|config)\b/.test(command)) {
          return 'git push/commit/remote/config is handled by the pipeline - do not run it yourself.';
        }
        try {
          const out = execSync(command, {
            cwd: ws.root,
            encoding: 'utf8',
            timeout: SHELL_TIMEOUT_MS,
            env: ws.safeEnv(),
            maxBuffer: 50 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          return clip(`exit 0\n${out || '(no output)'}`);
        } catch (err) {
          const stdout = err.stdout?.toString() ?? '';
          const stderr = err.stderr?.toString() ?? '';
          return clip(`exit ${err.status ?? 'timeout/signal'}\n${stdout}\n${stderr}`.trim());
        }
      },
    });
  }

  return [...tools, ...extra];
}
