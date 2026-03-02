import { chat, RouterError, ProviderHttpError, ProviderTimeoutError } from '../src/index';
import axios from 'axios';

jest.mock('axios');
const mockPost = axios.post as jest.MockedFunction<typeof axios.post>;

// jest.mock('axios') stubs out ALL exports including isAxiosError, so it
// returns undefined for every call. Restore the real implementation so the
// error-classification logic in index.ts works correctly in tests.
(axios.isAxiosError as unknown as jest.Mock).mockImplementation(
  (err: unknown) => (err as any)?.isAxiosError === true,
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MOCK_SUCCESS = {
  data: {
    choices: [{ message: { content: 'mock reply' } }],
    usage: { total_tokens: 10 },
  },
};

// Mirrors what axios throws when the server responds with a 4xx/5xx.
function makeAxiosHttpError(status: number, data: unknown = {}) {
  const err = new Error(`Request failed with status code ${status}`) as any;
  err.isAxiosError = true;
  err.code = undefined;
  err.response = { status, data };
  return err;
}

// Mirrors what axios throws on a connection timeout.
function makeAxiosTimeoutError(code: 'ECONNABORTED' | 'ERR_CANCELED' = 'ECONNABORTED') {
  const err = new Error('timeout of 0ms exceeded') as any;
  err.isAxiosError = true;
  err.code = code;
  err.response = undefined;
  return err;
}

// Axios network error — no response, no timeout code (e.g. DNS failure).
function makeAxiosNetworkError() {
  const err = new Error('Network Error') as any;
  err.isAxiosError = true;
  err.code = undefined;
  err.response = undefined;
  return err;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FLOCK_API_KEY  = 'test-flock-key';
  process.env.VENICE_API_KEY = 'test-venice-key';
  process.env.ZAI_API_KEY    = 'test-zai-key';
});

// ─── Role → Provider Routing ─────────────────────────────────────────────────

describe('role → provider routing', () => {
  it('routes generator to FLock with Qwen model', async () => {
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS);

    const result = await chat({
      role: 'generator',
      messages: [{ role: 'user', content: 'Fix this bug' }],
    });

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toContain('flock');
    expect((body as any).model).toContain('Qwen');
    expect(result.provider).toBe('flock');
    expect(result.content).toBe('mock reply');
  });

  it('routes reviewer to FLock with DeepSeek model', async () => {
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS);

    await chat({ role: 'reviewer', messages: [{ role: 'user', content: 'Review' }] });

    const [url, body] = mockPost.mock.calls[0];
    expect(url).toContain('flock');
    expect((body as any).model).toContain('DeepSeek');
  });

  it('routes orchestrator to FLock with Llama model', async () => {
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS);

    await chat({ role: 'orchestrator', messages: [{ role: 'user', content: 'Coordinate' }] });

    const [url, body] = mockPost.mock.calls[0];
    expect(url).toContain('flock');
    expect((body as any).model).toContain('Llama');
  });

  it('routes planner to Z.AI with GLM model', async () => {
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS);

    await chat({ role: 'planner', messages: [{ role: 'user', content: 'Plan' }] });

    const [url, body] = mockPost.mock.calls[0];
    expect(url).toContain('bigmodel');
    expect((body as any).model).toBe('glm-4');
  });
});

// ─── Request Parameters ───────────────────────────────────────────────────────

describe('request parameters', () => {
  it('passes temperature and maxTokens through to the provider', async () => {
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS);

    await chat({
      role: 'generator',
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0.9,
      maxTokens: 512,
    });

    const [, body] = mockPost.mock.calls[0];
    expect((body as any).temperature).toBe(0.9);
    expect((body as any).max_tokens).toBe(512);
  });

  // temperature=0 is a valid setting (fully deterministic). A falsy check
  // would silently drop it and use the default instead — that's a real bug.
  it('passes temperature=0 without treating it as falsy', async () => {
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS);

    await chat({
      role: 'generator',
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0,
    });

    const [, body] = mockPost.mock.calls[0];
    expect((body as any).temperature).toBe(0);
  });

  it('uses default temperature (0.2) when not provided', async () => {
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS);

    await chat({ role: 'generator', messages: [{ role: 'user', content: 'Hi' }] });

    const [, body] = mockPost.mock.calls[0];
    expect((body as any).temperature).toBe(0.2);
  });

  it('uses default maxTokens (4096) when not provided', async () => {
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS);

    await chat({ role: 'generator', messages: [{ role: 'user', content: 'Hi' }] });

    const [, body] = mockPost.mock.calls[0];
    expect((body as any).max_tokens).toBe(4096);
  });

  it('sends the full messages array unmodified', async () => {
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS);

    const messages = [
      { role: 'system' as const, content: 'You are a code reviewer.' },
      { role: 'user' as const, content: 'Review this function.' },
      { role: 'assistant' as const, content: 'Looks good, but rename the variable.' },
      { role: 'user' as const, content: 'Done. Anything else?' },
    ];

    await chat({ role: 'reviewer', messages });

    const [, body] = mockPost.mock.calls[0];
    expect((body as any).messages).toEqual(messages);
  });
});

// ─── Response Shape ───────────────────────────────────────────────────────────

describe('response shape', () => {
  it('returns content, model, provider, and tokensUsed', async () => {
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS);

    const result = await chat({
      role: 'orchestrator',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result.content).toBe('mock reply');
    expect(typeof result.model).toBe('string');
    expect(result.model.length).toBeGreaterThan(0);
    expect(result.provider).toBe('flock');
    expect(result.tokensUsed).toBe(10);
  });

  it('returns undefined tokensUsed when provider omits usage field', async () => {
    mockPost.mockResolvedValueOnce({
      data: { choices: [{ message: { content: 'reply' } }] },
      // no usage field
    });

    const result = await chat({
      role: 'generator',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.tokensUsed).toBeUndefined();
  });

  it('returns empty string content when the model replies with nothing', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        choices: [{ message: { content: '' } }],
        usage: { total_tokens: 1 },
      },
    });

    const result = await chat({
      role: 'generator',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.content).toBe('');
  });

  it('handles a very large content response without truncating', async () => {
    const bigContent = 'x'.repeat(100_000);
    mockPost.mockResolvedValueOnce({
      data: {
        choices: [{ message: { content: bigContent } }],
        usage: { total_tokens: 50000 },
      },
    });

    const result = await chat({
      role: 'generator',
      messages: [{ role: 'user', content: 'Write a lot' }],
    });

    expect(result.content).toHaveLength(100_000);
    expect(result.tokensUsed).toBe(50000);
  });

  it('preserves unicode and special characters in content', async () => {
    const unicodeContent = '你好 🤖 \n\t <script>alert(1)</script> & " \'';
    mockPost.mockResolvedValueOnce({
      data: {
        choices: [{ message: { content: unicodeContent } }],
        usage: { total_tokens: 20 },
      },
    });

    const result = await chat({
      role: 'generator',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.content).toBe(unicodeContent);
  });
});

// ─── Typed Error Classes ──────────────────────────────────────────────────────

describe('typed errors', () => {
  describe('ProviderHttpError', () => {
    it('is thrown on a 401 response', async () => {
      mockPost.mockRejectedValueOnce(makeAxiosHttpError(401, { error: 'Unauthorized' }));

      await expect(
        chat({ role: 'reviewer', messages: [{ role: 'user', content: 'Review' }] }),
      ).rejects.toThrow(ProviderHttpError);
    });

    it('is thrown on a 429 rate-limit response', async () => {
      mockPost.mockRejectedValueOnce(makeAxiosHttpError(429, { error: 'Rate limit exceeded' }));

      const err = await chat({
        role: 'reviewer',
        messages: [{ role: 'user', content: 'Review' }],
      }).catch((e) => e);

      expect(err).toBeInstanceOf(ProviderHttpError);
      expect(err.statusCode).toBe(429);
    });

    it('is thrown on a 500 internal server error', async () => {
      mockPost.mockRejectedValueOnce(makeAxiosHttpError(500, { error: 'Server error' }));

      const err = await chat({
        role: 'reviewer',
        messages: [{ role: 'user', content: 'Review' }],
      }).catch((e) => e);

      expect(err).toBeInstanceOf(ProviderHttpError);
      expect(err.statusCode).toBe(500);
    });

    it('is thrown on a 503 service-unavailable response', async () => {
      mockPost.mockRejectedValueOnce(makeAxiosHttpError(503));

      const err = await chat({
        role: 'planner',
        messages: [{ role: 'user', content: 'Plan' }],
      }).catch((e) => e);

      expect(err).toBeInstanceOf(ProviderHttpError);
      expect(err.statusCode).toBe(503);
    });

    it('carries role, provider, and model on the error', async () => {
      mockPost.mockRejectedValueOnce(makeAxiosHttpError(500));

      const err = await chat({
        role: 'reviewer',
        messages: [{ role: 'user', content: 'Review' }],
      }).catch((e) => e);

      expect(err.role).toBe('reviewer');
      expect(err.provider).toBe('flock');
      expect(typeof err.model).toBe('string');
      expect(err.model.length).toBeGreaterThan(0);
    });

    it('carries the response body from the provider', async () => {
      const body = { error: { message: 'context too long', code: 'context_length_exceeded' } };
      mockPost.mockRejectedValueOnce(makeAxiosHttpError(400, body));

      const err = await chat({
        role: 'reviewer',
        messages: [{ role: 'user', content: 'Review' }],
      }).catch((e) => e);

      expect(err.responseBody).toEqual(body);
    });

    it('is also an instance of RouterError and Error', async () => {
      mockPost.mockRejectedValueOnce(makeAxiosHttpError(500));

      const err = await chat({
        role: 'reviewer',
        messages: [{ role: 'user', content: 'Review' }],
      }).catch((e) => e);

      expect(err).toBeInstanceOf(RouterError);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ProviderHttpError');
    });
  });

  describe('ProviderTimeoutError', () => {
    it('is thrown on ECONNABORTED (axios timeout)', async () => {
      mockPost.mockRejectedValueOnce(makeAxiosTimeoutError('ECONNABORTED'));

      const err = await chat({
        role: 'reviewer',
        messages: [{ role: 'user', content: 'Review' }],
      }).catch((e) => e);

      expect(err).toBeInstanceOf(ProviderTimeoutError);
      expect(err.name).toBe('ProviderTimeoutError');
    });

    it('is thrown on ERR_CANCELED (AbortController signal)', async () => {
      mockPost.mockRejectedValueOnce(makeAxiosTimeoutError('ERR_CANCELED'));

      const err = await chat({
        role: 'reviewer',
        messages: [{ role: 'user', content: 'Review' }],
      }).catch((e) => e);

      expect(err).toBeInstanceOf(ProviderTimeoutError);
    });

    it('carries role, provider, and model on the error', async () => {
      mockPost.mockRejectedValueOnce(makeAxiosTimeoutError());

      const err = await chat({
        role: 'planner',
        messages: [{ role: 'user', content: 'Plan' }],
      }).catch((e) => e);

      expect(err.role).toBe('planner');
      expect(err.provider).toBe('zai');
      expect(typeof err.model).toBe('string');
    });

    it('is also an instance of RouterError and Error', async () => {
      mockPost.mockRejectedValueOnce(makeAxiosTimeoutError());

      const err = await chat({
        role: 'reviewer',
        messages: [{ role: 'user', content: 'Review' }],
      }).catch((e) => e);

      expect(err).toBeInstanceOf(RouterError);
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('RouterError (generic fallthrough)', () => {
    it('wraps a plain non-axios Error', async () => {
      // This simulates something like JSON parse failure inside the provider.
      mockPost.mockRejectedValueOnce(new Error('unexpected token in JSON'));

      const err = await chat({
        role: 'reviewer',
        messages: [{ role: 'user', content: 'Review' }],
      }).catch((e) => e);

      expect(err).toBeInstanceOf(RouterError);
      expect(err.message).toContain('unexpected token');
      expect(err.name).toBe('RouterError');
    });

    it('wraps an axios network error with no response (e.g. DNS failure)', async () => {
      mockPost.mockRejectedValueOnce(makeAxiosNetworkError());

      const err = await chat({
        role: 'reviewer',
        messages: [{ role: 'user', content: 'Review' }],
      }).catch((e) => e);

      // No response means it's not an HTTP error, not a timeout —
      // should fall through to the base RouterError.
      expect(err).toBeInstanceOf(RouterError);
    });
  });
});

// ─── requestId Propagation ────────────────────────────────────────────────────

describe('requestId propagation', () => {
  it('includes requestId on ProviderHttpError when provided', async () => {
    mockPost.mockRejectedValueOnce(makeAxiosHttpError(500));

    const err = await chat({
      role: 'reviewer',
      messages: [{ role: 'user', content: 'Review' }],
      requestId: 'req-abc-123',
    }).catch((e) => e);

    expect(err.requestId).toBe('req-abc-123');
  });

  it('includes requestId on ProviderTimeoutError when provided', async () => {
    mockPost.mockRejectedValueOnce(makeAxiosTimeoutError());

    const err = await chat({
      role: 'reviewer',
      messages: [{ role: 'user', content: 'Review' }],
      requestId: 'req-timeout-999',
    }).catch((e) => e);

    expect(err.requestId).toBe('req-timeout-999');
  });

  it('leaves requestId undefined on errors when not provided', async () => {
    mockPost.mockRejectedValueOnce(makeAxiosHttpError(500));

    const err = await chat({
      role: 'reviewer',
      messages: [{ role: 'user', content: 'Review' }],
      // no requestId
    }).catch((e) => e);

    expect(err.requestId).toBeUndefined();
  });
});

// ─── Fallback Behaviour ───────────────────────────────────────────────────────

describe('fallback behaviour', () => {
  it('falls back to Venice when FLock returns a generic error', async () => {
    mockPost
      .mockRejectedValueOnce(new Error('FLock down'))
      .mockResolvedValueOnce(MOCK_SUCCESS);

    const result = await chat({
      role: 'generator',
      messages: [{ role: 'user', content: 'Fix bug' }],
    });

    expect(mockPost).toHaveBeenCalledTimes(2);
    const [fallbackUrl] = mockPost.mock.calls[1];
    expect(fallbackUrl).toContain('venice');
    expect(result.provider).toBe('venice');
  });

  it('falls back to Venice when FLock returns an HTTP error', async () => {
    mockPost
      .mockRejectedValueOnce(makeAxiosHttpError(503))
      .mockResolvedValueOnce(MOCK_SUCCESS);

    const result = await chat({
      role: 'generator',
      messages: [{ role: 'user', content: 'Fix bug' }],
    });

    expect(result.provider).toBe('venice');
  });

  it('falls back to Venice when FLock times out', async () => {
    mockPost
      .mockRejectedValueOnce(makeAxiosTimeoutError())
      .mockResolvedValueOnce(MOCK_SUCCESS);

    const result = await chat({
      role: 'generator',
      messages: [{ role: 'user', content: 'Fix bug' }],
    });

    expect(result.provider).toBe('venice');
  });

  it('throws the fallback error when both primary and fallback fail', async () => {
    mockPost
      .mockRejectedValueOnce(new Error('FLock down'))
      .mockRejectedValueOnce(makeAxiosHttpError(503));

    const err = await chat({
      role: 'generator',
      messages: [{ role: 'user', content: 'Fix bug' }],
    }).catch((e) => e);

    // The error that surfaces should be from the Venice fallback call.
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err.provider).toBe('venice');
    expect(err.statusCode).toBe(503);
  });

  it('does not attempt fallback for reviewer (no fallback configured)', async () => {
    mockPost.mockRejectedValueOnce(makeAxiosHttpError(503));

    await expect(
      chat({ role: 'reviewer', messages: [{ role: 'user', content: 'Review' }] }),
    ).rejects.toBeInstanceOf(ProviderHttpError);

    // Only one call — no fallback attempted.
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('does not attempt fallback for planner (no fallback configured)', async () => {
    mockPost.mockRejectedValueOnce(makeAxiosHttpError(500));

    await expect(
      chat({ role: 'planner', messages: [{ role: 'user', content: 'Plan' }] }),
    ).rejects.toBeInstanceOf(ProviderHttpError);

    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});

// ─── Environment Variable Edge Cases ─────────────────────────────────────────

describe('environment variable edge cases', () => {
  it('throws when FLOCK_API_KEY is missing', async () => {
    delete process.env.FLOCK_API_KEY;

    await expect(
      chat({ role: 'reviewer', messages: [{ role: 'user', content: 'Review' }] }),
    ).rejects.toThrow('FLOCK_API_KEY is not set');
  });

  it('throws when ZAI_API_KEY is missing for planner role', async () => {
    delete process.env.ZAI_API_KEY;

    await expect(
      chat({ role: 'planner', messages: [{ role: 'user', content: 'Plan' }] }),
    ).rejects.toThrow('ZAI_API_KEY is not set');
  });

  it('throws when VENICE_API_KEY is missing and fallback is triggered', async () => {
    delete process.env.VENICE_API_KEY;
    mockPost.mockRejectedValueOnce(new Error('FLock down'));

    // FLock fails → tries Venice fallback → Venice throws missing key error.
    await expect(
      chat({ role: 'generator', messages: [{ role: 'user', content: 'Fix' }] }),
    ).rejects.toThrow('VENICE_API_KEY is not set');
  });
});

// ─── Error Handling — Unknown / Borderline Inputs ────────────────────────────

describe('unknown and borderline inputs', () => {
  it('throws for an unknown role', async () => {
    await expect(
      chat({ role: 'unknown' as any, messages: [] }),
    ).rejects.toThrow('No model config for role');
  });

  it('throws for null role', async () => {
    await expect(
      chat({ role: null as any, messages: [] }),
    ).rejects.toThrow('No model config for role');
  });

  it('throws for empty-string role', async () => {
    await expect(
      chat({ role: '' as any, messages: [] }),
    ).rejects.toThrow('No model config for role');
  });

  it('passes an empty messages array to the provider without throwing', async () => {
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS);

    // llm-router itself does not validate messages — that's the provider's job.
    // It should pass through and let the provider respond (or error) naturally.
    await expect(
      chat({ role: 'generator', messages: [] }),
    ).resolves.toBeDefined();

    const [, body] = mockPost.mock.calls[0];
    expect((body as any).messages).toEqual([]);
  });
});

// ─── Concurrent Calls ────────────────────────────────────────────────────────

describe('concurrent calls', () => {
  it('handles multiple simultaneous calls independently', async () => {
    // Three calls in parallel — each gets its own resolved value.
    mockPost
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: 'reply-1' } }], usage: { total_tokens: 1 } } })
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: 'reply-2' } }], usage: { total_tokens: 2 } } })
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: 'reply-3' } }], usage: { total_tokens: 3 } } });

    const [r1, r2, r3] = await Promise.all([
      chat({ role: 'generator',   messages: [{ role: 'user', content: 'A' }], requestId: 'req-1' }),
      chat({ role: 'reviewer',    messages: [{ role: 'user', content: 'B' }], requestId: 'req-2' }),
      chat({ role: 'orchestrator',messages: [{ role: 'user', content: 'C' }], requestId: 'req-3' }),
    ]);

    expect(r1.content).toBe('reply-1');
    expect(r2.content).toBe('reply-2');
    expect(r3.content).toBe('reply-3');
    expect(mockPost).toHaveBeenCalledTimes(3);
  });

  it('isolates failures — one failing call does not affect others', async () => {
    mockPost
      .mockRejectedValueOnce(makeAxiosHttpError(500))
      .mockResolvedValueOnce(MOCK_SUCCESS);

    const [err, result] = await Promise.allSettled([
      chat({ role: 'reviewer',  messages: [{ role: 'user', content: 'Review' }] }),
      chat({ role: 'planner',   messages: [{ role: 'user', content: 'Plan' }] }),
    ]);

    expect(err.status).toBe('rejected');
    expect(result.status).toBe('fulfilled');
  });
});
