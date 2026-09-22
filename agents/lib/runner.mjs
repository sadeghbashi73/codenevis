/**
 * The agent loop.
 *
 * Feeds a system prompt plus a task to the model, executes whatever tools it
 * asks for, and keeps going until the model stops calling tools, hits the step
 * budget, or calls a tool marked `terminal: true`.
 */

import { createClient } from './providers.mjs';

const MAX_RESULT_CHARS = 30_000;

function blockText(blocks) {
  return blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

/**
 * @param {object} o
 * @param {object} o.agent      resolved agent config (model, apiKey, provider, maxSteps, ...)
 * @param {string} o.system     system prompt
 * @param {string} o.task       the initial user message
 * @param {Array}  o.tools      tool definitions from buildTools()
 * @param {string} o.name       label used in logs
 */
export async function runAgent({ agent, system, task, tools, name = 'agent' }) {
  const client = createClient(agent);
  const maxSteps = agent.maxSteps ?? 40;
  const messages = [{ role: 'user', content: [{ type: 'text', text: task }] }];
  const usage = { input: 0, output: 0, steps: 0 };
  const byName = new Map(tools.map((t) => [t.name, t]));
  let terminalResult = null;
  let finalText = '';

  console.log(`\n=== ${name} :: ${client.label} :: up to ${maxSteps} steps ===\n`);

  for (let step = 1; step <= maxSteps; step++) {
    usage.steps = step;
    const res = await client.chat({ system, messages, tools });
    usage.input += res.usage.input;
    usage.output += res.usage.output;

    const text = blockText(res.blocks);
    if (text) {
      finalText = text;
      console.log(`[${name} ${step}] ${text.slice(0, 1200)}`);
    }

    const calls = res.blocks.filter((b) => b.type === 'tool_use');
    if (!calls.length) {
      console.log(`[${name}] finished at step ${step} (no tool calls)`);
      break;
    }

    messages.push({ role: 'assistant', content: res.blocks });

    const results = [];
    for (const call of calls) {
      const tool = byName.get(call.name);
      let output;
      let isError = false;
      if (!tool) {
        output = `unknown tool "${call.name}"`;
        isError = true;
      } else {
        const preview = JSON.stringify(call.input ?? {}).slice(0, 300);
        console.log(`[${name} ${step}] -> ${call.name} ${preview}`);
        try {
          output = await tool.run(call.input ?? {});
        } catch (err) {
          output = `error: ${err.message}`;
          isError = true;
        }
        if (tool.terminal) terminalResult = call.input ?? {};
      }
      const body = typeof output === 'string' ? output : JSON.stringify(output);
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: body.slice(0, MAX_RESULT_CHARS),
        is_error: isError,
      });
      if (!isError) console.log(`[${name} ${step}] <- ${body.slice(0, 400)}`);
      else console.log(`[${name} ${step}] <- ERROR ${body.slice(0, 400)}`);
    }

    messages.push({ role: 'user', content: results });

    if (terminalResult) {
      console.log(`[${name}] finished at step ${step} (terminal tool)`);
      break;
    }

    if (step === maxSteps) {
      console.log(`[${name}] hit the ${maxSteps}-step budget`);
    }
  }

  console.log(
    `\n=== ${name} done :: ${usage.steps} steps :: ${usage.input} in / ${usage.output} out tokens ===\n`
  );

  return { result: terminalResult, text: finalText, usage };
}
