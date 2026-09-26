// Multi-provider LLM Engine with native support for:
// 1. Ollama (local offline inference at http://localhost:11434, zero dependencies)
// 2. OpenAI-compatible local/cloud APIs (LM Studio, LocalAI, vLLM, OpenRouter, Groq, OpenAI)
// 3. Anthropic Claude (via @anthropic-ai/sdk or native REST)
// 4. Offline heuristic templates (always available, no API key needed)

import { MODELS } from '../web/core/schema.js';
import { env } from './env.js';

// cfg reads a setting: values saved in Settings › Connect your accounts first, then .env.
export async function createLlm(cfg = env) {
  const provider = (cfg('LLM_PROVIDER') || '').toLowerCase();
  const anthropicKey = cfg('ANTHROPIC_API_KEY');
  const openaiKey = env('OPENAI_API_KEY');
  const openaiBase = env('OPENAI_BASE_URL') || env('LOCAL_LLM_URL') || env('LM_STUDIO_URL');
  const ollamaHost = (env('OLLAMA_HOST') || env('OLLAMA_BASE_URL') || 'http://localhost:11434').replace(/\/$/, '');

  // Check Ollama availability
  let ollamaAvailable = false;
  let ollamaModels = [];
  if (provider === 'ollama' || (!anthropicKey && !openaiKey && !openaiBase) || provider === '') {
    try {
      const res = await fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(1200) });
      if (res.ok) {
        const j = await res.json();
        ollamaModels = (j.models || []).map((m) => m.name);
        if (ollamaModels.length) ollamaAvailable = true;
      }
    } catch {
      ollamaAvailable = false;
    }
  }

  // Determine active provider
  if (provider === 'anthropic' || (anthropicKey && provider !== 'ollama' && provider !== 'openai')) {
    return createAnthropicLlm(anthropicKey);
  }

  if (provider === 'openai' || (openaiBase && provider !== 'ollama')) {
    return createOpenAiLlm({ apiKey: openaiKey || 'local', baseUrl: openaiBase || 'http://localhost:1234/v1' });
  }

  if (ollamaAvailable || provider === 'ollama') {
    return createOllamaLlm({ host: ollamaHost, models: ollamaModels });
  }

  return {
    available: false,
    provider: 'offline',
    reason: 'No local Ollama instance or API key detected. Running in offline template mode.',
    async test() {
      return { ok: false, provider: 'offline', reason: 'Running in offline template mode.' };
    },
  };
}

// ---------------------------------------------------------------------------
// Ollama Provider (Native fetch, zero npm packages)
// ---------------------------------------------------------------------------

function createOllamaLlm({ host, models: installedModels = [] }) {
  const pickModel = (purpose) => {
    if (installedModels.length) {
      if (purpose === 'tag') {
        const small = installedModels.find((m) => /(1\.5b|2b|3b|coder)/i.test(m));
        if (small) return small;
      }
      const primary = installedModels.find((m) => /(qwen|llama|mistral|deepseek)/i.test(m));
      if (primary) return primary;
      return installedModels[0];
    }
    return env('OLLAMA_MODEL', 'llama3.1:8b');
  };

  const defaultModel = pickModel('draft');

  async function chat(opts, jsonMode = false) {
    const model = opts.model || env(`HOPE_MODEL_${(opts.purpose || 'draft').toUpperCase()}`) || pickModel(opts.purpose);
    const messages = [];
    if (opts.system) messages.push({ role: 'system', content: opts.system });
    messages.push({ role: 'user', content: opts.prompt });

    const payload = {
      model,
      messages,
      stream: false,
      options: {
        temperature: opts.purpose === 'final' ? 0.3 : 0.6,
        num_predict: opts.max_tokens || 8192,
      },
      ...(jsonMode ? { format: 'json' } : {}),
    };

    const res = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama (${model}): ${res.status} ${errText}`);
    }

    const data = await res.json();
    const content = data.message?.content || '';
    const promptTokens = data.prompt_eval_count || Math.round((opts.prompt?.length || 0) / 4);
    const completionTokens = data.eval_count || Math.round(content.length / 4);

    return {
      text: content,
      model: `ollama/${model}`,
      usage: { input_tokens: promptTokens, output_tokens: completionTokens },
    };
  }

  return {
    available: true,
    provider: 'ollama',
    host,
    defaultModel,
    installedModels,
    async json(opts) {
      const prompt = `${opts.prompt}\n\nIMPORTANT: Respond with ONLY a valid JSON object matching this schema, with no markdown fences, commentary or intro:\n${JSON.stringify(opts.schema || {})}`;
      const { text, usage, model } = await chat({ ...opts, prompt }, true);
      const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
      let data;
      try {
        data = JSON.parse(cleaned);
      } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) {
          try { data = JSON.parse(match[0]); } catch { throw new Error('Local AI returned invalid JSON format.'); }
        } else {
          throw new Error('Local AI returned text instead of JSON.');
        }
      }
      return { data, usage, model };
    },
    async text(opts) {
      const { text, usage, model } = await chat(opts, false);
      return { data: text, usage, model };
    },
    async test() {
      try {
        const t0 = Date.now();
        const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
        const j = await res.json();
        const models = (j.models || []).map((m) => m.name);
        return { ok: true, provider: 'ollama', host, latency_ms: Date.now() - t0, models, activeModel: defaultModel };
      } catch (err) {
        return { ok: false, provider: 'ollama', reason: err.message };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// OpenAI-Compatible Provider (LM Studio, LocalAI, vLLM, OpenRouter, Groq)
// ---------------------------------------------------------------------------

function createOpenAiLlm({ apiKey, baseUrl }) {
  const defaultModel = env('OPENAI_MODEL', 'gpt-4o-mini');

  async function chat(opts, jsonMode = false) {
    const model = opts.model || defaultModel;
    const messages = [];
    if (opts.system) messages.push({ role: 'system', content: opts.system });
    messages.push({ role: 'user', content: opts.prompt });

    const payload = {
      model,
      messages,
      temperature: 0.5,
      max_tokens: opts.max_tokens || 4096,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    };

    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI-compatible (${model}): ${res.status} ${errText}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const usage = {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
    };

    return { text: content, model, usage };
  }

  return {
    available: true,
    provider: 'openai',
    baseUrl,
    defaultModel,
    async json(opts) {
      const prompt = `${opts.prompt}\n\nProvide response in JSON format.`;
      const { text, usage, model } = await chat({ ...opts, prompt }, true);
      const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
      return { data: JSON.parse(cleaned), usage, model };
    },
    async text(opts) {
      const { text, usage, model } = await chat(opts, false);
      return { data: text, usage, model };
    },
    async test() {
      try {
        const t0 = Date.now();
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(3000),
        });
        return { ok: res.ok, provider: 'openai', baseUrl, latency_ms: Date.now() - t0 };
      } catch (err) {
        return { ok: false, provider: 'openai', reason: err.message };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Anthropic Claude Provider
// ---------------------------------------------------------------------------

async function createAnthropicLlm(apiKey) {
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    return { available: false, provider: 'anthropic', reason: 'Run `npm install` in hope-studio/ to add the Anthropic SDK.' };
  }
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  const models = {
    draft: env('HOPE_MODEL_DRAFT', MODELS.draft),
    review: env('HOPE_MODEL_REVIEW', MODELS.review),
    final: env('HOPE_MODEL_FINAL', MODELS.final),
    tag: env('HOPE_MODEL_TAG', MODELS.tag),
  };

  function userContent(opts) {
    const parts = [];
    for (const img of opts.images || []) {
      const m = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/.exec(img);
      if (m) parts.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
    }
    parts.push({ type: 'text', text: opts.prompt });
    return parts;
  }

  const textOf = (res) => res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');

  async function run(opts, format) {
    const model = models[opts.purpose] || models.draft;
    const output_config = {};
    if (!/haiku/.test(model)) output_config.effort = opts.purpose === 'final' ? 'high' : opts.purpose === 'tag' ? 'low' : 'medium';
    if (format) output_config.format = format;

    let res;
    try {
      res = await client.messages.create({
        model,
        max_tokens: opts.max_tokens || 16000,
        system: opts.system,
        messages: [{ role: 'user', content: userContent(opts) }],
        ...(Object.keys(output_config).length ? { output_config } : {}),
      });
    } catch (err) {
      if (format && err instanceof Anthropic.BadRequestError && /output_config|format|schema/i.test(err.message)) {
        res = await client.messages.create({
          model,
          max_tokens: opts.max_tokens || 16000,
          system: `${opts.system}\n\nRespond with only a JSON object matching this schema:\n${JSON.stringify(format.schema)}`,
          messages: [{ role: 'user', content: userContent(opts) }],
        });
      } else {
        throw err;
      }
    }
    return { res, model };
  }

  return {
    available: true,
    provider: 'anthropic',
    models,
    async json(opts) {
      const { res, model } = await run(opts, { type: 'json_schema', schema: opts.schema });
      const raw = textOf(res).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
      return { data: JSON.parse(raw), usage: res.usage, model };
    },
    async text(opts) {
      const { res, model } = await run(opts, null);
      return { data: textOf(res), usage: res.usage, model };
    },
    async pdfText(base64) {
      const stream = client.messages.stream({
        model: models.draft,
        max_tokens: 64000,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: 'Transcribe the full text of this document as plain text. Keep headings on their own lines, prefixed with "## ". Do not summarize or add anything.' },
          ],
        }],
      });
      const msg = await stream.finalMessage();
      return textOf(msg);
    },
    // Confirms the key works without spending tokens (Settings › Claude).
    async check() {
      const page = await client.models.list({ limit: 20 });
      return (page.data || []).map((m) => m.id);
    },
    async test() {
      try {
        const t0 = Date.now();
        await client.messages.create({
          model: models.tag,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'ping' }],
        });
        return { ok: true, provider: 'anthropic', models, latency_ms: Date.now() - t0 };
      } catch (err) {
        return { ok: false, provider: 'anthropic', reason: err.message };
      }
    },
  };
}
