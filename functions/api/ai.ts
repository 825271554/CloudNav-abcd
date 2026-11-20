import { normalizeAIConfig } from '../../services/aiConfig.ts';
import type { AIConfig } from '../../types.ts';

interface Env {
  PASSWORD: string;
}

class AIError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

function assertPublicEndpoint(baseUrl: string) {
  const url = new URL(baseUrl);
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  const privateV4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(hostname);
  const localName = !hostname.includes('.') || /\.(?:localhost|local|internal|test)$/.test(hostname) || hostname === 'metadata.google.internal';
  const ipv6Literal = hostname.includes(':');
  const ipv4Literal = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
  if (privateV4 || localName || ipv6Literal || ipv4Literal) {
    throw new AIError('AI API 地址必须是可公开访问的域名，不能使用本机或内网地址');
  }
}

function safeUpstreamError(data: any, config: AIConfig): string {
  let message = typeof data?.error?.message === 'string' ? data.error.message : '';
  for (const secret of [config.apiKey, ...Object.values(config.customHeaders || {})]) {
    if (secret) message = message.split(secret).join('[已隐藏]');
  }
  return message.slice(0, 300);
}

async function upstreamJSON(url: string | URL, config: AIConfig, signal: AbortSignal, body?: unknown): Promise<any> {
  const headers = new Headers(config.customHeaders);
  headers.set('Content-Type', 'application/json');
  headers.set('User-Agent', config.userAgent || 'CloudNav/1.0');
  if (config.provider === 'gemini') headers.set('x-goog-api-key', config.apiKey);
  else headers.set('Authorization', `Bearer ${config.apiKey}`);

  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
    redirect: 'manual',
  });
  if (response.status >= 300 && response.status < 400) {
    throw new AIError('API 地址发生重定向，请填写重定向后的最终 API 地址', 502);
  }
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new AIError(`AI 服务返回了非 JSON 响应（HTTP ${response.status}），请检查 API 地址`, 502);
  }
  if (!response.ok) {
    const detail = safeUpstreamError(data, config);
    const hint = response.status === 401 || response.status === 403 ? '，请检查 API Key 和访问权限' : '';
    throw new AIError(`AI 服务请求失败（HTTP ${response.status}）${hint}${detail ? `：${detail}` : ''}`, 502);
  }
  return data;
}

async function listModels(config: AIConfig, signal: AbortSignal) {
  const models = new Map<string, { id: string; name: string }>();
  if (config.provider === 'openai') {
    const data = await upstreamJSON(`${config.baseUrl}/models`, config, signal);
    if (!Array.isArray(data?.data)) throw new AIError('模型列表格式不正确，服务应返回 data 数组', 502);
    for (const model of data.data) {
      if (typeof model?.id === 'string' && model.id.trim()) {
        models.set(model.id, { id: model.id, name: typeof model.name === 'string' ? model.name : model.id });
      }
    }
  } else {
    let pageToken = '';
    const seenTokens = new Set<string>();
    do {
      const url = new URL(`${config.baseUrl}/models`);
      url.searchParams.set('pageSize', '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const data = await upstreamJSON(url, config, signal);
      if (!Array.isArray(data?.models)) throw new AIError('模型列表格式不正确，服务应返回 models 数组', 502);
      for (const model of data.models) {
        if (Array.isArray(model?.supportedGenerationMethods) && !model.supportedGenerationMethods.includes('generateContent')) continue;
        if (typeof model?.name !== 'string' || !model.name.trim()) continue;
        const id = model.name.replace(/^models\//, '');
        models.set(id, { id, name: typeof model.displayName === 'string' ? model.displayName : id });
      }
      pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
      if (pageToken && (seenTokens.has(pageToken) || seenTokens.size >= 20)) {
        throw new AIError('模型列表分页异常，请稍后重试', 502);
      }
      if (pageToken) seenTokens.add(pageToken);
    } while (pageToken);
  }
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function generate(config: AIConfig, signal: AbortSignal, systemPrompt: string, userPrompt: string) {
  if (!config.model) throw new AIError('请选择或填写模型名称');
  if (config.provider === 'gemini') {
    const data = await upstreamJSON(`${config.baseUrl}/models/${encodeURIComponent(config.model)}:generateContent`, config, signal, {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    });
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('').trim()
      : '';
    if (!text) throw new AIError('模型未返回文本，可能不支持文字生成或内容被拦截', 502);
    return text;
  }
  const data = await upstreamJSON(`${config.baseUrl}/chat/completions`, config, signal, {
    model: config.model,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    stream: false,
  });
  const content = data?.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content.trim()
    : Array.isArray(content) ? content.filter(part => typeof part?.text === 'string').map(part => part.text).join('').trim() : '';
  if (!text) throw new AIError('模型未返回文本，请确认所选模型支持聊天补全', 502);
  return text;
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  if (!env.PASSWORD) return json({ error: '服务端未配置访问密码，无法使用 AI 服务' }, 503);
  if (request.headers.get('x-auth-password') !== env.PASSWORD) return json({ error: '登录已失效，请重新登录' }, 401);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求内容必须是 JSON' }, 400);
  }
  if (!['models', 'generate', 'test'].includes(body?.operation)) return json({ error: '不支持的 AI 操作' }, 400);
  let config: AIConfig;
  try {
    config = normalizeAIConfig(body.config);
    assertPublicEndpoint(config.baseUrl);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'AI 配置无效' }, 400);
  }
  if (body.operation === 'generate' && (
    typeof body.systemPrompt !== 'string' || typeof body.userPrompt !== 'string' ||
    !body.userPrompt.trim() || body.systemPrompt.length > 10000 || body.userPrompt.length > 20000
  )) return json({ error: '生成内容为空或超过长度限制' }, 400);

  const controller = new AbortController();
  const cancel = () => controller.abort();
  request.signal.addEventListener('abort', cancel, { once: true });
  if (request.signal.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutSeconds! * 1000);
  try {
    if (body.operation === 'models') return json({ models: await listModels(config, controller.signal) });
    const start = Date.now();
    const text = await generate(config, controller.signal,
      body.operation === 'test' ? 'You are a connection test assistant.' : body.systemPrompt,
      body.operation === 'test' ? 'Reply with OK only.' : body.userPrompt,
    );
    return json({ text, latencyMs: Date.now() - start });
  } catch (error) {
    if (timedOut) return json({ error: `AI 请求超时（${config.timeoutSeconds} 秒）` }, 504);
    if (controller.signal.aborted) return json({ error: '请求已取消' }, 499);
    if (error instanceof AIError) return json({ error: error.message }, error.status);
    return json({ error: '无法连接 AI 服务，请检查 API 地址及服务状态' }, 502);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', cancel);
  }
};
