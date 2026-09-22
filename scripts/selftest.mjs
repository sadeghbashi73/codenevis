#!/usr/bin/env node
/**
 * Self test for the pipeline plumbing.
 *
 * Runs the real agent loop, the real tool layer, and the real provider
 * adapters against a stubbed HTTP layer, so the whole path is exercised
 * without spending a token or touching GitHub.
 *
 *   node scripts/selftest.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Workspace, buildTools } from '../agents/lib/tools.mjs';
import { runAgent } from '../agents/lib/runner.mjs';
import { taskBody, taskOrder, acceptanceCriteria, branchFor } from '../agents/lib/pipeline.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'codenevis-selftest-'));
fs.mkdirSync(path.join(sandbox, 'src'));
fs.writeFileSync(path.join(sandbox, 'src', 'app.js'), 'export const answer = 42;\n');
fs.mkdirSync(path.join(sandbox, '.github', 'workflows'), { recursive: true });
fs.writeFileSync(path.join(sandbox, '.github', 'workflows', 'ci.yml'), 'name: ci\n');

console.log('\ntool sandbox');

await test('list_files shows the tree', () => {
  const tools = buildTools(new Workspace(sandbox));
  const out = tools.find((t) => t.name === 'list_files').run({ path: '.' });
  assert.match(out, /src\//);
  assert.match(out, /src\/app\.js/);
});

await test('read_file returns numbered lines', () => {
  const tools = buildTools(new Workspace(sandbox));
  const out = tools.find((t) => t.name === 'read_file').run({ path: 'src/app.js' });
  assert.match(out, /1\texport const answer = 42;/);
});

await test('write_file creates nested directories', () => {
  const ws = new Workspace(sandbox);
  const out = buildTools(ws).find((t) => t.name === 'write_file').run({
    path: 'src/deep/nested/mod.js',
    content: 'export default 1;\n',
  });
  assert.match(out, /wrote src\/deep\/nested\/mod\.js/);
  assert.ok(fs.existsSync(path.join(sandbox, 'src/deep/nested/mod.js')));
  assert.ok(ws.touched.has('src/deep/nested/mod.js'));
});

await test('edit_file refuses an ambiguous match', () => {
  const ws = new Workspace(sandbox);
  fs.writeFileSync(path.join(sandbox, 'dup.txt'), 'a\na\n');
  const out = buildTools(ws).find((t) => t.name === 'edit_file').run({
    path: 'dup.txt',
    old_string: 'a',
    new_string: 'b',
  });
  assert.match(out, /appears 2 times/);
});

await test('paths cannot escape the repository', () => {
  const tools = buildTools(new Workspace(sandbox));
  assert.throws(
    () => tools.find((t) => t.name === 'read_file').run({ path: '../../../etc/passwd' }),
    /escapes the repository/
  );
});

await test('the pipeline itself is protected from writes', () => {
  const tools = buildTools(new Workspace(sandbox));
  const write = tools.find((t) => t.name === 'write_file');
  assert.throws(() => write.run({ path: '.github/workflows/ci.yml', content: 'x' }), /protected/);
  assert.throws(() => write.run({ path: 'agents/dev.mjs', content: 'x' }), /protected/);
  assert.throws(() => write.run({ path: 'config/agents.json', content: '{}' }), /protected/);
});

await test('a read-only workspace exposes no write tools', () => {
  const names = buildTools(new Workspace(sandbox, { readOnly: true })).map((t) => t.name);
  assert.ok(!names.includes('write_file'));
  assert.ok(!names.includes('delete_file'));
  assert.ok(names.includes('read_file'));
});

await test('secrets are stripped from the shell environment', () => {
  process.env.DEV_API_KEY = 'sk-ant-should-not-leak';
  process.env.GITHUB_TOKEN = 'ghp-should-not-leak';
  const env = new Workspace(sandbox).safeEnv();
  assert.equal(env.DEV_API_KEY, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.CI, 'true');
  delete process.env.DEV_API_KEY;
  delete process.env.GITHUB_TOKEN;
});

await test('run executes a command and captures the exit code', () => {
  const tools = buildTools(new Workspace(sandbox));
  const run = tools.find((t) => t.name === 'run');
  assert.match(run.run({ command: 'echo hello' }), /exit 0[\s\S]*hello/);
  assert.match(run.run({ command: 'exit 3' }), /exit 3/);
  assert.match(run.run({ command: 'git push origin main' }), /handled by the pipeline/);
});

console.log('\ntask format');

await test('a task round-trips through its issue body', () => {
  const body = taskBody({
    order: 7,
    description: 'Build the thing.',
    acceptance_criteria: ['It returns 200', 'It rejects an empty name'],
    files: ['src/api.js'],
    requirements: ['FR-1'],
    briefNumber: 3,
  });
  const issue = { body, title: '[T07] Build the thing' };
  assert.equal(taskOrder(issue), 7);
  assert.deepEqual(acceptanceCriteria(issue), ['It returns 200', 'It rejects an empty name']);
});

await test('task order falls back to the title', () => {
  assert.equal(taskOrder({ title: '[T03] Something', body: 'no marker' }), 3);
});

await test('branch names are derived safely', () => {
  assert.equal(branchFor({ number: 12, title: '[T02] Add the /todos REST endpoints!' }), 'task/12-add-the-todos-rest-endpoints');
  assert.equal(branchFor({ number: 5, title: '[T01] ???' }), 'task/5');
});

console.log('\nagent loop (stubbed provider)');

const realFetch = globalThis.fetch;

/** Scripted Anthropic responses: call a tool, then answer. */
function stubAnthropic(script) {
  let turn = 0;
  globalThis.fetch = async (url, opts) => {
    assert.match(String(url), /\/v1\/messages$/);
    const body = JSON.parse(opts.body);
    assert.equal(body.model, 'stub-model');
    assert.ok(Array.isArray(body.tools) && body.tools.length > 0, 'tools should be sent');
    const reply = script[Math.min(turn++, script.length - 1)];
    return new Response(
      JSON.stringify({ content: reply.content, stop_reason: reply.stop_reason, usage: { input_tokens: 10, output_tokens: 5 } }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };
}

await test('the loop executes a tool call and feeds the result back', async () => {
  stubAnthropic([
    {
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Reading the file.' },
        { type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'src/app.js' } },
      ],
    },
    {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu_2', name: 'done', input: { summary: 'the answer is 42' } }],
    },
  ]);

  const ws = new Workspace(sandbox);
  const done = {
    name: 'done',
    terminal: true,
    description: 'finish',
    parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
    run: () => 'ok',
  };

  const { result, usage } = await runAgent({
    agent: { provider: 'anthropic', model: 'stub-model', apiKey: 'stub', maxSteps: 5 },
    system: 'you are a test',
    task: 'read the file then finish',
    tools: buildTools(ws, { shell: false, extra: [done] }),
    name: 'test',
  });

  assert.equal(result.summary, 'the answer is 42');
  assert.equal(usage.steps, 2);
  assert.equal(usage.input, 20);
});

await test('the loop stops when the model asks for no tools', async () => {
  stubAnthropic([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'nothing to do' }] }]);
  const { result, text, usage } = await runAgent({
    agent: { provider: 'anthropic', model: 'stub-model', apiKey: 'stub', maxSteps: 5 },
    system: 's',
    task: 't',
    tools: buildTools(new Workspace(sandbox), { shell: false }),
    name: 'test',
  });
  assert.equal(result, null);
  assert.equal(text, 'nothing to do');
  assert.equal(usage.steps, 1);
});

await test('a failing tool comes back as an error result, not a crash', async () => {
  stubAnthropic([
    {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: '../escape' } }],
    },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'recovered' }] },
  ]);
  const { text } = await runAgent({
    agent: { provider: 'anthropic', model: 'stub-model', apiKey: 'stub', maxSteps: 4 },
    system: 's',
    task: 't',
    tools: buildTools(new Workspace(sandbox), { shell: false }),
    name: 'test',
  });
  assert.equal(text, 'recovered');
});

await test('the step budget is enforced', async () => {
  stubAnthropic([
    {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'loop', name: 'list_files', input: { path: '.' } }],
    },
  ]);
  const { usage } = await runAgent({
    agent: { provider: 'anthropic', model: 'stub-model', apiKey: 'stub', maxSteps: 3 },
    system: 's',
    task: 't',
    tools: buildTools(new Workspace(sandbox), { shell: false }),
    name: 'test',
  });
  assert.equal(usage.steps, 3);
});

console.log('\nOpenAI-compatible translation');

await test('tool calls and results translate to the OpenAI shape', async () => {
  const seen = [];
  globalThis.fetch = async (url, opts) => {
    assert.match(String(url), /\/chat\/completions$/);
    const body = JSON.parse(opts.body);
    seen.push(body.messages);
    const first = seen.length === 1;
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: first ? 'tool_calls' : 'stop',
            message: first
              ? { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_files', arguments: '{"path":"."}' } }] }
              : { content: 'all done' },
          },
        ],
        usage: { prompt_tokens: 7, completion_tokens: 2 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  const { text } = await runAgent({
    agent: { provider: 'openai', baseUrl: 'https://example.test/v1', model: 'stub', apiKey: 'stub', maxSteps: 4 },
    system: 'sys',
    task: 'go',
    tools: buildTools(new Workspace(sandbox), { shell: false }),
    name: 'test',
  });

  assert.equal(text, 'all done');
  const second = seen[1];
  assert.equal(second[0].role, 'system');
  const assistant = second.find((m) => m.role === 'assistant');
  assert.equal(assistant.tool_calls[0].function.name, 'list_files');
  const toolResult = second.find((m) => m.role === 'tool');
  assert.equal(toolResult.tool_call_id, 'c1');
  assert.match(toolResult.content, /src\//);
});

await test('a retryable status is retried, a fatal one is not', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return new Response('rate limited', { status: 429 });
    return new Response(
      JSON.stringify({ content: [{ type: 'text', text: 'recovered' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }),
      { status: 200 }
    );
  };
  const { text } = await runAgent({
    agent: { provider: 'anthropic', model: 'stub-model', apiKey: 'stub', maxSteps: 2 },
    system: 's',
    task: 't',
    tools: [],
    name: 'test',
  });
  assert.equal(text, 'recovered');
  assert.equal(calls, 2);

  globalThis.fetch = async () => new Response('bad key', { status: 401 });
  await assert.rejects(
    runAgent({
      agent: { provider: 'anthropic', model: 'stub-model', apiKey: 'bad', maxSteps: 2 },
      system: 's',
      task: 't',
      tools: [],
      name: 'test',
    }),
    /401/
  );
});

globalThis.fetch = realFetch;
fs.rmSync(sandbox, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
