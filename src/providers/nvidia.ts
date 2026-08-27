import { createOpenAICompatibleProvider } from './openai-compatible';

const provider = createOpenAICompatibleProvider({
  envKey: process.env.NVIDIA_API_KEY,
  envName: 'NVIDIA_API_KEY',
  baseURL: process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
});

export const nvidiaAvailable = provider.available;
export const nvidiaModel = provider.model;
