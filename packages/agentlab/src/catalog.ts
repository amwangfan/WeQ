import type { AgentLabProviderCatalogEntry } from './types';

/**
 * 厂商模板（whale-io 专用线）：收敛为用户自己的 AgentScope OpenAI 兼容端点。
 * 上游的多厂商模板（硅基流动 / DeepSeek 官方 / 智谱 / Moonshot / 百炼 / OpenAI /
 * Ollama）已移除——whale-io 部署的 LLM 全部走这一个端点，避免误配到其它厂商；
 * 保留「OpenAI 兼容（自定义）」空模板作为换端点的逃生口。
 * 该平台无 TTS / 向量 / 视觉模型：语音与向量检索保持关闭（记忆走关键词召回）。
 */
export const AGENTLAB_PROVIDER_CATALOG: AgentLabProviderCatalogEntry[] = [
  {
    vendor: 'agentscope',
    label: 'AgentScope（whale-io 专用）',
    baseUrl: 'https://platform.agentscope.io/v1',
    apiKeyHint: 'agentscope 平台 API Key',
    recommended: true,
    models: [
      {
        id: 'deepseek-v4.1-flash-1017',
        label: 'DeepSeek V4.1 Flash（固定版）',
        capabilities: ['chat'],
      },
      { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', capabilities: ['chat'] },
      { id: 'deepseek-v4-pro-0813', label: 'DeepSeek V4 Pro', capabilities: ['chat'] },
      { id: 'glm-5.2', label: 'GLM 5.2', capabilities: ['chat'] },
      { id: 'kimi-k3', label: 'Kimi K3', capabilities: ['chat'] },
      { id: 'qwen3.7-plus', label: 'Qwen3.7 Plus', capabilities: ['chat'] },
      { id: 'qwen3.8-flash', label: 'Qwen3.8 Flash', capabilities: ['chat'] },
      { id: 'qwen3.8-max', label: 'Qwen3.8 Max', capabilities: ['chat'] },
    ],
  },
  {
    vendor: 'openai-compatible',
    label: 'OpenAI 兼容（自定义）',
    baseUrl: '',
    apiKeyHint: '任意 OpenAI 兼容服务',
    models: [],
  },
];

export function findCatalogEntry(vendor: string): AgentLabProviderCatalogEntry | undefined {
  return AGENTLAB_PROVIDER_CATALOG.find((item) => item.vendor === vendor);
}
