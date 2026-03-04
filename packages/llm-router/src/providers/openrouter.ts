import axios from 'axios';
import { ChatMessage, ChatResponse } from '../types';

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

    const payload: any = {
        model: modelId,
        messages,
        temperature,
        stream: true,
    };
    if (maxTokens) {
        payload.max_tokens = maxTokens;
    }

    const response = await axios.post(
        `${BASE_URL}/chat/completions`,
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

    let accumulatedContent = '';
    let buffer = '';

    for await (const chunk of response.data) {
        buffer += chunk.toString('utf-8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;

            const dataStr = trimmed.slice(6).trim();
            if (dataStr === '[DONE]') continue;

            try {
                const parsed = JSON.parse(dataStr);
                if (parsed.choices?.[0]?.delta?.content) {
                    accumulatedContent += parsed.choices[0].delta.content;
                }
            } catch (e) {
                // Ignored, maybe partial chunk
            }
        }
    }

    return {
        content: accumulatedContent,
        model: modelId,
        provider: 'openrouter',
    };
}
