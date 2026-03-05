import { ChatMessage, ChatResponse } from '../types';
import { callOpenAiCompatible } from './openaiCompatible';

const BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

export async function callOpenRouter(
    modelId: string,
    messages: ChatMessage[],
    temperature = 0.2,
    maxTokens?: number,
    timeoutMs?: number,
): Promise<ChatResponse> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('[llm-router] OPENROUTER_API_KEY is not set');

    const result = await callOpenAiCompatible({
        provider: 'openrouter',
        baseUrl: BASE_URL,
        apiKey,
        modelId,
        messages,
        temperature,
        maxTokens,
        timeoutMs,
        streamModeEnvKey: 'OPENROUTER_STREAMING_MODE',
    });

    return {
        content: result.content,
        model: modelId,
        provider: 'openrouter',
    };
}
