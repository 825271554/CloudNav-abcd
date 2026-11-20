import type { AIConfig, AIProvider } from '../types.ts';

export const DEFAULT_AI_BASE_URLS: Record<AIProvider, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  openai: 'https://api.openai.com/v1',
};

export interface AIModel {
  id: string;
  name: string;
}

const reservedHeaders = new Set([
  'authorization', 'x-goog-api-key', 'user-agent', 'content-type',
  'host', 'content-length', 'connection', 'transfer-encoding',
  'cookie', 'set-cookie', 'x-auth-password', 'upgrade', 'trailer', 'te',
]);

export function normalizeAIBaseUrl(provider: AIProvider, value: string): string {
  const input = value.trim() || DEFAULT_AI_BASE_URLS[provider];
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('API 地址格式不正确，请填写完整的 http:// 或 https:// 地址');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('API 地址仅支持 HTTP/HTTPS，不能包含用户名、密码、查询参数或锚点');
  }

  let path = url.pathname.replace(/\/+$/, '');
  path = path.replace(/\/(?:chat\/completions|models)$/, '');
  if (!path) path = provider === 'gemini' ? '/v1beta' : '/v1';
  url.pathname = path;
  return url.toString().replace(/\/+$/, '');
}

export function validateCustomHeaders(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('自定义请求头必须是 JSON 对象');
  }
  const entries = Object.entries(value);
  if (entries.length > 20) throw new Error('自定义请求头最多 20 个');
  const headers = new Headers();
  for (const [name, content] of entries) {
    const lower = name.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new Error(`请求头名称无效：${name}`);
    if (reservedHeaders.has(lower) || lower.startsWith('sec-') || lower.startsWith('proxy-')) {
      throw new Error(`请勿设置 ${name}，认证和 User-Agent 请使用单独设置项`);
    }
    if (typeof content !== 'string' || content.length > 4096 || /[^\t\x20-\x7e\x80-\xff]/.test(content)) {
      throw new Error(`请求头 ${name} 的值必须是有效的单行字符串`);
    }
    headers.set(name, content);
  }
  return Object.fromEntries(headers.entries());
}

export function normalizeAIConfig(value: unknown): AIConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('缺少 AI 配置');
  const config = value as AIConfig;
  if (config.provider !== 'gemini' && config.provider !== 'openai') throw new Error('不支持的 AI 提供商');
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
  if (!apiKey) throw new Error('请先填写 API Key');
  if (apiKey.length > 4096 || /[^\x21-\x7e]/.test(apiKey)) throw new Error('API Key 包含无效字符');
  const userAgent = typeof config.userAgent === 'string' ? config.userAgent.trim() : '';
  if (userAgent.length > 512 || /[^\x20-\x7e]/.test(userAgent)) throw new Error('User-Agent 必须是最多 512 个字符的单行英文字符串');
  const timeoutSeconds = config.timeoutSeconds ?? 60;
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 300) {
    throw new Error('请求超时须为 5 到 300 秒之间的整数');
  }
  let model = typeof config.model === 'string' ? config.model.trim() : '';
  if (config.provider === 'gemini') model = model.replace(/^models\//, '') || 'gemini-2.5-flash';
  if (model.length > 256 || /[\r\n]/.test(model)) throw new Error('模型名称无效');
  return {
    ...config,
    apiKey,
    model,
    baseUrl: normalizeAIBaseUrl(config.provider, typeof config.baseUrl === 'string' ? config.baseUrl : ''),
    userAgent,
    timeoutSeconds,
    customHeaders: validateCustomHeaders(config.customHeaders),
  };
}
