export interface ProviderPreset {
  id: string
  name: string
  badge: string
  description: string
  provider: 'chatgpt' | 'openai'
  protocol: 'responses' | 'chat-completions'
  baseUrl: string
  isOAuth?: boolean
  hideEndpoint?: boolean
  defaultModel?: string
  placeholderModel?: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT account',
    badge: 'CHATGPT',
    description: 'Browser sign-in with your ChatGPT subscription',
    provider: 'chatgpt',
    protocol: 'responses',
    baseUrl: '',
    isOAuth: true,
    hideEndpoint: true
  },
  {
    id: 'openai',
    name: 'OpenAI',
    badge: 'OPENAI',
    description: 'API key for OpenAI models (GPT-4o, o1, o3-mini)',
    provider: 'openai',
    protocol: 'chat-completions',
    baseUrl: 'https://api.openai.com/v1',
    hideEndpoint: true,
    placeholderModel: 'gpt-4o'
  },
  {
    id: 'anthropic',
    name: 'Claude / Anthropic',
    badge: 'ANTHROPIC',
    description: 'API key for Claude models via OpenAI-compatible endpoint',
    provider: 'openai',
    protocol: 'chat-completions',
    baseUrl: 'https://api.anthropic.com/v1',
    hideEndpoint: true,
    placeholderModel: 'claude-3-7-sonnet-20250219'
  },
  {
    id: 'gemini',
    name: 'Gemini',
    badge: 'GEMINI',
    description: 'API key for Google Gemini models via OpenAI-compatible endpoint',
    provider: 'openai',
    protocol: 'chat-completions',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    hideEndpoint: true,
    placeholderModel: 'gemini-2.5-flash'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    badge: 'DEEPSEEK',
    description: 'API key for DeepSeek models (deepseek-chat, deepseek-reasoner)',
    provider: 'openai',
    protocol: 'chat-completions',
    baseUrl: 'https://api.deepseek.com',
    hideEndpoint: true,
    placeholderModel: 'deepseek-chat'
  },
  {
    id: 'moonshot',
    name: 'Kimi / Moonshot',
    badge: 'MOONSHOT',
    description: 'API key for Moonshot AI models (moonshot-v1)',
    provider: 'openai',
    protocol: 'chat-completions',
    baseUrl: 'https://api.moonshot.cn/v1',
    hideEndpoint: true,
    placeholderModel: 'moonshot-v1-8k'
  },
  {
    id: 'custom',
    name: 'OpenAI-compatible',
    badge: 'OPENAI COMPATIBLE',
    description: 'Custom endpoint for LM Studio, Ollama, vLLM, or local server',
    provider: 'openai',
    protocol: 'chat-completions',
    baseUrl: 'http://127.0.0.1:1234/v1',
    hideEndpoint: false,
    placeholderModel: 'Load models or enter an ID'
  }
]

export function findPresetForConnection(connection?: {
  provider?: string
  baseUrl?: string
}): ProviderPreset {
  if (!connection) {
    return PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1]
  }
  if (connection.provider === 'chatgpt' || connection.provider === 'codex') {
    return PROVIDER_PRESETS[0]
  }
  const cleanUrl = (connection.baseUrl || '').trim().replace(/\/+$/, '')
  const matched = PROVIDER_PRESETS.find(
    p => !p.isOAuth && p.baseUrl && cleanUrl === p.baseUrl.replace(/\/+$/, '')
  )
  return matched ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1]
}
