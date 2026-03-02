import axios from 'axios';
import { ChatMessage, ChatResponse } from '../types';

// FLock uses an OpenAI-compatible API format.
// Override the base URL via env var if their endpoint changes.
const BASE_URL = process.env.FLOCK_BASE_URL ?? 'https://api.flock.io/v1';

export async function callFlock(
  modelId: string,
  messages: ChatMessage[],
  temperature = 0.2,
  maxTokens = 4096,
  timeoutMs?: number,
): Promise<ChatResponse> {
  const apiKey = process.env.FLOCK_API_KEY;
  if (!apiKey) throw new Error('[llm-router] FLOCK_API_KEY is not set');

  const response = await axios.post(
    `${BASE_URL}/chat/completions`,
    {
      model: modelId,
      messages,
      temperature,
      max_tokens: maxTokens,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      ...(timeoutMs !== undefined && { timeout: timeoutMs }),
    },
  );

  return {
    content: response.data.choices[0].message.content,
    model: modelId,
    provider: 'flock',
    tokensUsed: response.data.usage?.total_tokens,
  };
}
