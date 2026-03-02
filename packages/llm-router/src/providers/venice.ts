import axios from 'axios';
import { ChatMessage, ChatResponse } from '../types';

// Venice.ai is the fallback for the generator — chosen because it explicitly
// does not log or train on input content, protecting customer codebase IP.
const BASE_URL = process.env.VENICE_BASE_URL ?? 'https://api.venice.ai/api/v1';

export async function callVenice(
  modelId: string,
  messages: ChatMessage[],
  temperature = 0.2,
  maxTokens = 4096,
): Promise<ChatResponse> {
  const apiKey = process.env.VENICE_API_KEY;
  if (!apiKey) throw new Error('[llm-router] VENICE_API_KEY is not set');

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
    },
  );

  return {
    content: response.data.choices[0].message.content,
    model: modelId,
    provider: 'venice',
    tokensUsed: response.data.usage?.total_tokens,
  };
}
