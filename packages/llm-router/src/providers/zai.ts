import axios from 'axios';
import { ChatMessage, ChatResponse } from '../types';

// Z.AI (Zhipu AI) hosts GLM-4, used for the architecture planner role.
// Their API is OpenAI-compatible.
const BASE_URL = process.env.ZAI_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4';

export async function callZai(
  modelId: string,
  messages: ChatMessage[],
  temperature = 0.2,
  maxTokens = 4096,
): Promise<ChatResponse> {
  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey) throw new Error('[llm-router] ZAI_API_KEY is not set');

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
    provider: 'zai',
    tokensUsed: response.data.usage?.total_tokens,
  };
}
