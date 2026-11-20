import type { AIConfig } from '../types.ts';
import { normalizeAIConfig, type AIModel } from './aiConfig.ts';

interface AIResponse {
  text?: string;
  models?: AIModel[];
  latencyMs?: number;
  error?: string;
}

interface AIRequestOptions {
  signal?: AbortSignal;
}

async function requestAI(
  operation: 'models' | 'generate' | 'test',
  config: AIConfig,
  payload: Record<string, string> = {},
  options: AIRequestOptions = {},
): Promise<AIResponse> {
  const normalized = normalizeAIConfig(config);
  if (operation !== 'models' && !normalized.model) throw new Error('请选择或填写模型名称');
  const authToken = localStorage.getItem('cloudnav_auth_token');
  if (!authToken) throw new Error('请先登录后再使用 AI 服务');

  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, (normalized.timeoutSeconds! + 5) * 1000);

  try {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-auth-password': authToken },
      body: JSON.stringify({ operation, config: normalized, ...payload }),
      signal: controller.signal,
    });
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('AI 服务端接口不可用，请确认已部署 /api/ai 服务');
    }
    const data: AIResponse = await response.json();
    if (!response.ok) throw new Error(data.error || `AI 请求失败（HTTP ${response.status}）`);
    return data;
  } catch (error) {
    if (timedOut) throw new Error(`AI 请求超时（${normalized.timeoutSeconds} 秒），可在 AI 设置中调整`);
    if (options.signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
    if (error instanceof TypeError) throw new Error('无法连接 AI 服务，请检查网络及 API 地址');
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}

export async function fetchAIModels(config: AIConfig, options?: AIRequestOptions): Promise<AIModel[]> {
  const data = await requestAI('models', config, {}, options);
  return data.models || [];
}

export async function testAIConnection(config: AIConfig, options?: AIRequestOptions): Promise<number> {
  const data = await requestAI('test', config, {}, options);
  return data.latencyMs || 0;
}

export async function generateLinkDescription(title: string, url: string, config: AIConfig, options?: AIRequestOptions): Promise<string> {
  const data = await requestAI('generate', config, {
    systemPrompt: 'You summarize website bookmarks. Return only a short description in Simplified Chinese, with no quotes.',
    userPrompt: `Title: ${title}\nURL: ${url}\nPlease describe what this website is for, in no more than 30 Chinese characters.`,
  }, options);
  if (!data.text?.trim()) throw new Error('模型没有返回描述，请更换模型后重试');
  return data.text.trim();
}

export async function suggestCategory(title: string, url: string, categories: { id: string; name: string }[], config: AIConfig, options?: AIRequestOptions): Promise<string | null> {
  if (!categories.length) return null;
  const data = await requestAI('generate', config, {
    systemPrompt: 'You classify website bookmarks. Output only one category ID from the supplied list.',
    userPrompt: `Website: ${title} (${url})\nAvailable categories:\n${categories.map(category => `${category.id}: ${category.name}`).join('\n')}\nReturn only the ID of the best matching category.`,
  }, options);
  const id = data.text?.trim();
  return categories.some(category => category.id === id) ? id! : null;
}
