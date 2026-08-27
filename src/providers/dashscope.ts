import { createOpenAICompatibleProvider } from './openai-compatible';

const provider = createOpenAICompatibleProvider({
  envKey: process.env.DASHSCOPE_API_KEY,
  envName: 'DASHSCOPE_API_KEY',
  baseURL: process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
});

export const dashscopeAvailable = provider.available;
export const dashscopeModel = provider.model;
