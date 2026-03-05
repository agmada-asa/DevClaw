import axios from 'axios';
import { ChatMessage } from '../types';

type StreamingMode = 'auto' | 'on' | 'off';

interface OpenAiCompatibleCallInput {
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens?: number;
  timeoutMs?: number;
  streamModeEnvKey?: string;
}

interface OpenAiCompatibleCallResult {
  content: string;
  streamModeUsed: 'stream' | 'non-stream';
}

const DEFAULT_STREAMING_MODE: StreamingMode = 'auto';

const normalizeStreamingMode = (value: string | undefined): StreamingMode => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'on' || normalized === 'off' || normalized === 'auto') {
    return normalized;
  }
  return DEFAULT_STREAMING_MODE;
};

const getStreamingMode = (streamModeEnvKey?: string): StreamingMode => {
  if (streamModeEnvKey) {
    return normalizeStreamingMode(process.env[streamModeEnvKey]);
  }
  return normalizeStreamingMode(process.env.LLM_ROUTER_STREAMING_MODE);
};

const buildPayload = (
  modelId: string,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number | undefined,
  stream: boolean,
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    model: modelId,
    messages,
    temperature,
    stream,
  };
  if (maxTokens !== undefined) {
    payload.max_tokens = maxTokens;
  }
  return payload;
};

const parseContentFromNonStreamingResponse = (data: any): string => {
  const messageContent = data?.choices?.[0]?.message?.content;
  if (typeof messageContent === 'string') {
    return messageContent;
  }

  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
  }

  return '';
};

const parseStreamingText = async (streamData: AsyncIterable<Buffer | string>): Promise<string> => {
  let accumulatedContent = '';
  let buffer = '';

  for await (const chunk of streamData) {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) {
        continue;
      }

      const dataStr = trimmed.slice(5).trim();
      if (!dataStr || dataStr === '[DONE]') {
        continue;
      }

      const parsed = JSON.parse(dataStr);
      const deltaContent = parsed?.choices?.[0]?.delta?.content;
      if (typeof deltaContent === 'string') {
        accumulatedContent += deltaContent;
      }
    }
  }

  return accumulatedContent;
};

const postStreaming = async (
  baseUrl: string,
  apiKey: string,
  payload: Record<string, unknown>,
  timeoutMs?: number,
): Promise<string> => {
  const response = await axios.post(
    `${baseUrl}/chat/completions`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      responseType: 'stream',
      ...(timeoutMs !== undefined && { timeout: timeoutMs }),
    },
  );

  return await parseStreamingText(response.data as AsyncIterable<Buffer | string>);
};

const postNonStreaming = async (
  baseUrl: string,
  apiKey: string,
  payload: Record<string, unknown>,
  timeoutMs?: number,
): Promise<string> => {
  const response = await axios.post(
    `${baseUrl}/chat/completions`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      ...(timeoutMs !== undefined && { timeout: timeoutMs }),
    },
  );

  return parseContentFromNonStreamingResponse(response.data);
};

export const resolveBoundedMaxTokens = (
  callerMaxTokens: number | undefined,
  defaultMaxTokens: number,
  cap: number,
): number => {
  const requested = callerMaxTokens ?? defaultMaxTokens;
  if (!Number.isFinite(requested) || requested <= 0) {
    return Math.min(defaultMaxTokens, cap);
  }
  return Math.min(Math.floor(requested), cap);
};

export async function callOpenAiCompatible(input: OpenAiCompatibleCallInput): Promise<OpenAiCompatibleCallResult> {
  const {
    provider,
    baseUrl,
    apiKey,
    modelId,
    messages,
    temperature,
    maxTokens,
    timeoutMs,
    streamModeEnvKey,
  } = input;

  const mode = getStreamingMode(streamModeEnvKey);
  const streamPayload = buildPayload(modelId, messages, temperature, maxTokens, true);
  const nonStreamPayload = buildPayload(modelId, messages, temperature, maxTokens, false);

  if (mode === 'off') {
    const content = await postNonStreaming(baseUrl, apiKey, nonStreamPayload, timeoutMs);
    return { content, streamModeUsed: 'non-stream' };
  }

  try {
    const content = await postStreaming(baseUrl, apiKey, streamPayload, timeoutMs);
    return { content, streamModeUsed: 'stream' };
  } catch (err) {
    if (mode === 'on') {
      throw err;
    }

    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[llm-router][${provider}] Streaming request failed for model "${modelId}"; ` +
      `retrying once with non-streaming mode. Reason: ${message}`,
    );

    const content = await postNonStreaming(baseUrl, apiKey, nonStreamPayload, timeoutMs);
    return { content, streamModeUsed: 'non-stream' };
  }
}