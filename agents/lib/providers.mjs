/**
 * LLM provider adapters.
 *
 * Canonical message shape is the Anthropic one:
 *   assistant: [{type:'text',text}, {type:'tool_use',id,name,input}]
 *   user:      [{type:'text',text}, {type:'tool_result',tool_use_id,content,is_error}]
 *
 * Every provider translates to/from that shape so the agent loop stays
 * provider-agnostic. Add a new provider by exporting another factory here.
 */

const RETRY_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const MAX_RETRIES = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, options, label) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(60_000, 1500 * 2 ** (attempt - 1)) + Math.random() * 500;
      console.log(`[${label}] retry ${attempt}/${MAX_RETRIES} in ${Math.round(backoff)}ms — ${lastErr}`);
      await sleep(backoff);
    }
    let res;
    try {
      res = await fetch(url, options);
    } catch (err) {
      lastErr = `network: ${err.message}`;
      continue;
    }
    const text = await res.text();
    if (res.ok) {
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`[${label}] response was not JSON: ${text.slice(0, 500)}`);
      }
    }
    lastErr = `HTTP ${res.status}: ${text.slice(0, 800)}`;
    if (!RETRY_STATUS.has(res.status)) throw new Error(`[${label}] ${lastErr}`);
  }
  throw new Error(`[${label}] gave up after ${MAX_RETRIES} retries — ${lastErr}`);
}

/* ------------------------------------------------------------------ */
/* Anthropic                                                           */
/* ------------------------------------------------------------------ */

function anthropicClient(cfg) {
  const baseUrl = (cfg.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
  return {
    label: `anthropic:${cfg.model}`,
    async chat({ system, messages, tools, maxTokens }) {
      const body = {
        model: cfg.model,
        max_tokens: maxTokens ?? cfg.maxTokens ?? 8192,
        temperature: cfg.temperature ?? 0.2,
        system,
        messages,
      };
      if (tools?.length) {
        body.tools = tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        }));
      }
      const data = await request(
        `${baseUrl}/v1/messages`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': cfg.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
        },
        'anthropic'
      );
      return {
        blocks: data.content ?? [],
        stopReason: data.stop_reason,
        usage: {
          input: data.usage?.input_tokens ?? 0,
          output: data.usage?.output_tokens ?? 0,
        },
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* OpenAI-compatible (OpenRouter, Groq, Together, vLLM, Ollama, ...)   */
/* ------------------------------------------------------------------ */

function toOpenAIMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const msg of messages) {
    const blocks = Array.isArray(msg.content)
      ? msg.content
      : [{ type: 'text', text: msg.content }];

    if (msg.role === 'assistant') {
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const calls = blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({
          id: b.id,
          type: 'function',
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      const entry = { role: 'assistant', content: text || null };
      if (calls.length) entry.tool_calls = calls;
      out.push(entry);
      continue;
    }

    // user turn: tool results must each become their own `tool` message
    const results = blocks.filter((b) => b.type === 'tool_result');
    for (const r of results) {
      out.push({
        role: 'tool',
        tool_call_id: r.tool_use_id,
        content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
      });
    }
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (text) out.push({ role: 'user', content: text });
  }
  return out;
}

function openaiClient(cfg) {
  const baseUrl = (cfg.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  return {
    label: `openai-compatible:${cfg.model}`,
    async chat({ system, messages, tools, maxTokens }) {
      const body = {
        model: cfg.model,
        max_tokens: maxTokens ?? cfg.maxTokens ?? 8192,
        temperature: cfg.temperature ?? 0.2,
        messages: toOpenAIMessages(system, messages),
      };
      if (tools?.length) {
        body.tools = tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
        body.tool_choice = 'auto';
      }
      const headers = {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      };
      if (baseUrl.includes('openrouter')) {
        headers['HTTP-Referer'] = 'https://github.com/sadeghbashi73/codenevis';
        headers['X-Title'] = 'codenevis';
      }
      const data = await request(
        `${baseUrl}/chat/completions`,
        { method: 'POST', headers, body: JSON.stringify(body) },
        'openai-compatible'
      );
      const choice = data.choices?.[0];
      if (!choice) throw new Error(`no choices in response: ${JSON.stringify(data).slice(0, 500)}`);
      const blocks = [];
      if (choice.message?.content) blocks.push({ type: 'text', text: choice.message.content });
      for (const call of choice.message?.tool_calls ?? []) {
        let input = {};
        try {
          input = JSON.parse(call.function.arguments || '{}');
        } catch {
          input = { __raw: call.function.arguments };
        }
        blocks.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
      }
      return {
        blocks,
        stopReason: choice.finish_reason === 'tool_calls' ? 'tool_use' : choice.finish_reason,
        usage: {
          input: data.usage?.prompt_tokens ?? 0,
          output: data.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}

export function createClient(cfg) {
  const provider = (cfg.provider || 'anthropic').toLowerCase();
  if (!cfg.apiKey) throw new Error(`missing API key for provider "${provider}"`);
  switch (provider) {
    case 'anthropic':
      return anthropicClient(cfg);
    case 'openai':
    case 'openrouter':
    case 'compatible':
      return openaiClient(cfg);
    default:
      throw new Error(`unknown provider "${provider}" (use: anthropic | openai | openrouter)`);
  }
}
