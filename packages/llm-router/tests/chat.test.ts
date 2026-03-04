import { chat, RouterError, ProviderHttpError, ProviderTimeoutError } from '../src/index';
import axios from 'axios';

jest.mock('axios');
const mockPost = axios.post as jest.MockedFunction<typeof axios.post>;

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

// Queues the same rejection N times so tests can cover all retry attempts.
// Each role has a maxRetries value — you need (1 + maxRetries) rejections to
// exhaust all primary attempts and reach the fallback or final throw.
//
// Current policy values:
//   reviewer    maxRetries: 2  →  3 rejections to exhaust
//   generator   maxRetries: 1  →  2 rejections to exhaust
//   orchestrator maxRetries: 1 →  2 rejections to exhaust
//   planner     maxRetries: 1  →  2 rejections to exhaust
//
// Only errors listed in the role's fallbackOn trigger retries.
// Permanent errors (401, generic RouterError) break out on the first attempt.
function mockRejectN(err: unknown, n: number): void {
  for (let i = 0; i < n; i++) mockPost.mockRejectedValueOnce(err);
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  // resetAllMocks clears both queued return values AND implementations.
  // We need it (not clearAllMocks) so leftover mockResolvedValueOnce queues
  // from a failed test don't bleed into the next test.
  jest.resetAllMocks();

  // Restore isAxiosError since resetAllMocks wiped its implementation.
  // jest.mock('axios') stubs it as a dead function that returns undefined,
  // so we need to give it the real check manually.
  (axios.isAxiosError as unknown as jest.Mock).mockImplementation(
    (err: unknown) => (err as any)?.isAxiosError === true,
  );

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
    it('is thrown on a 401 response (no retry — 401 not in fallbackOn)', async () => {
      // 401 is not in reviewer's fallbackOn ['timeout','http5xx'], so it
      // breaks out immediately with 1 attempt.
      mockPost.mockRejectedValueOnce(makeAxiosHttpError(401, { error: 'Unauthorized' }));

      await expect(
        chat({ role: 'reviewer', messages: [{ role: 'user', content: 'Review' }] }),
      ).rejects.toThrow(ProviderHttpError);

      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    it('is thrown on a 429 rate-limit response (no retry for reviewer — 429 not in its fallbackOn)', async () => {
      // reviewer's fallbackOn is ['timeout','http5xx'] — no http429 entry.
      mockPost.mockRejectedValueOnce(makeAxiosHttpError(429, { error: 'Rate limit exceeded' }));

      const err = await chat({
        role: 'reviewer',
        messages: [{ role: 'user', content: 'Review' }],
      }).catch((e) => e);

      expect(err).toBeInstanceOf(ProviderHttpError);
      expect(err.statusCode).toBe(429);
      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    it('is thrown on a 500 after exhausting all retries (reviewer maxRetries: 2 → 3 attempts)', async () => {
      // 500 IS in reviewer's fallbackOn (http5xx), so it retries twice first.
      mockRejectN(makeAxiosHttpError(500, { error: 'Server error' }), 3);

      const err = await chat({
        role: 'reviewer',
        messages: [{ role: 'user', content: 'Review' }],
      }).catch((e) => e);

      expect(err).toBeInstanceOf(ProviderHttpError);
      expect(err.statusCode).toBe(500);
      expect(mockPost).toHaveBeenCalledTimes(3);
    });

    it('is thrown on a 503 after exhausting all retries (planner maxRetries: 1 → 2 attempts)', async () => {
      mockRejectN(makeAxiosHttpError(503), 2);

      const err = await chat({
        role: 'planner',
        messages: [{ role: 'user', content: 'Plan' }],
      }).catch((e) => e);

      expect(err).toBeInstanceOf(ProviderHttpError);
      expect(err.statusCode).toBe(503);
      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    it('carries role, provider, and model on the error', async () => {
      mockRejectN(makeAxiosHttpError(500), 3); // reviewer exhausts 3 attempts

      const err = await chat({
        role: 'reviewer',
        messages: [{ role: 'user', content: 'Review' }],
      }).catch((e) => e);

      expect(err.role).toBe('reviewer');
      expect(err.provider).toBe('flock');
      expect(typeof err.model).toBe('string');
      expect(err.model.length).toBeGreaterThan(0);
    });

    it('carries the response body from the provider (no retry — 400 not in fallbackOn)', async () => {
      const body = { error: { message: 'context too long', code: 'context_length_exceeded' } };
      mockPost.mockRejectedValueOnce(makeAxiosHttpError(400, body));

      const err = await chat({
        role: 'reviewer',
        messages: [{ role: 'user', content: 'Review' }],
      }).catch((e) => e);

      expect(err.responseBody).toEqual(body);
      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    it('is also an instance of RouterError and Error', async () => {
      mockRejectN(makeAxiosHttpError(500), 3);

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
    it('is thrown on ECONNABORTED after exhausting retries (reviewer maxRetries: 2 → 3 attempts)', async () => {
      // timeout IS in reviewer's fallbackOn, so it retries twice first.
      mockRejectN(makeAxiosTimeoutError('ECONNABORTED'), 3);

      const err = await chat({
        role: 'reviewer',
        messages: [{ role: 'user', content: 'Review' }],
      }).catch((e) => e);

      expect(err).toBeInstanceOf(ProviderTimeoutError);
      expect(err.name).toBe('ProviderTimeoutError');
      expect(mockPost).toHaveBeenCalledTimes(3);
    });

    it('is thrown on ERR_CANCELED after exhausting retries', async () => {
      mockRejectN(makeAxiosTimeoutError('ERR_CANCELED'), 3);

      const err = await chat({
        role: 'reviewer',
        messages: [{ role: 'user', content: 'Review' }],
      }).catch((e) => e);

      expect(err).toBeInstanceOf(ProviderTimeoutError);
    });

    it('carries role, provider, and model on the error (planner maxRetries: 1 → 2 attempts)', async () => {
      mockRejectN(makeAxiosTimeoutError(), 2);

      const err = await chat({
        role: 'planner',
        messages: [{ role: 'user', content: 'Plan' }],
      }).catch((e) => e);

      expect(err.role).toBe('planner');
      expect(err.provider).toBe('zai');
      expect(typeof err.model).toBe('string');
      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    it('is also an instance of RouterError and Error', async () => {
      mockRejectN(makeAxiosTimeoutError(), 3);

      const err = await chat({
        role: 'reviewer',
        messages: [{ role: 'user', content: 'Review' }],
      }).catch((e) => e);

      expect(err).toBeInstanceOf(RouterError);
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('RouterError (generic fallthrough)', () => {
    it('wraps a plain non-axios Error (no retry — not in fallbackOn)', async () => {
      // Generic errors are not in any fallbackOn list, so no retries.
      mockPost.mockRejectedValueOnce(new Error('unexpected token in JSON'));

      const err = await chat({
        role: 'reviewer',
        messages: [{ role: 'user', content: 'Review' }],
      }).catch((e) => e);

      expect(err).toBeInstanceOf(RouterError);
      expect(err.message).toContain('unexpected token');
      expect(err.name).toBe('RouterError');
      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    it('wraps an axios network error with no response (no retry — not in fallbackOn)', async () => {
      // Network error has no response → RouterError → not in fallbackOn → no retry.
      mockPost.mockRejectedValueOnce(makeAxiosNetworkError());

      const err = await chat({
        role: 'reviewer',
        messages: [{ role: 'user', content: 'Review' }],
      }).catch((e) => e);

      expect(err).toBeInstanceOf(RouterError);
      expect(mockPost).toHaveBeenCalledTimes(1);
    });
  });
});

// ─── requestId Propagation ────────────────────────────────────────────────────

describe('requestId propagation', () => {
  it('includes requestId on ProviderHttpError when provided', async () => {
    // reviewer + 500: retries twice before giving up (maxRetries: 2 → 3 total)
    mockRejectN(makeAxiosHttpError(500), 3);

    const err = await chat({
      role: 'reviewer',
      messages: [{ role: 'user', content: 'Review' }],
      requestId: 'req-abc-123',
    }).catch((e) => e);

    expect(err.requestId).toBe('req-abc-123');
  });

  it('includes requestId on ProviderTimeoutError when provided', async () => {
    mockRejectN(makeAxiosTimeoutError(), 3);

    const err = await chat({
      role: 'reviewer',
      messages: [{ role: 'user', content: 'Review' }],
      requestId: 'req-timeout-999',
    }).catch((e) => e);

    expect(err.requestId).toBe('req-timeout-999');
  });

  it('leaves requestId undefined on errors when not provided', async () => {
    mockRejectN(makeAxiosHttpError(500), 3);

    const err = await chat({
      role: 'reviewer',
      messages: [{ role: 'user', content: 'Review' }],
    }).catch((e) => e);

    expect(err.requestId).toBeUndefined();
  });
});

// ─── Retry Behaviour ─────────────────────────────────────────────────────────

describe('retry behaviour', () => {
  it('retries the primary provider before falling back (generator maxRetries: 1)', async () => {
    // Attempt 1: fails, retry attempt 2: succeeds — no fallback needed.
    mockPost
      .mockRejectedValueOnce(makeAxiosHttpError(503))
      .mockResolvedValueOnce(MOCK_SUCCESS);

    const result = await chat({
      role: 'generator',
      messages: [{ role: 'user', content: 'Fix bug' }],
    });

    // Both calls went to FLock (retry), not Venice (fallback).
    expect(mockPost).toHaveBeenCalledTimes(2);
    const [url1] = mockPost.mock.calls[0];
    const [url2] = mockPost.mock.calls[1];
    expect(url1).toContain('flock');
    expect(url2).toContain('flock');
    expect(result.provider).toBe('flock');
  });

  it('does NOT retry on permanent errors (401)', async () => {
    mockPost.mockRejectedValueOnce(makeAxiosHttpError(401));

    const err = await chat({
      role: 'generator',
      messages: [{ role: 'user', content: 'Fix bug' }],
    }).catch((e) => e);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err.statusCode).toBe(401);
  });

  it('retries reviewer up to maxRetries (2) times before throwing', async () => {
    mockRejectN(makeAxiosHttpError(503), 3);

    await chat({
      role: 'reviewer',
      messages: [{ role: 'user', content: 'Review' }],
    }).catch(() => {});

    expect(mockPost).toHaveBeenCalledTimes(3);
  });

  it('succeeds on a later retry without ever hitting the fallback', async () => {
    mockPost
      .mockRejectedValueOnce(makeAxiosHttpError(503))  // retry 1 fails
      .mockRejectedValueOnce(makeAxiosHttpError(503))  // retry 2 fails
      .mockResolvedValueOnce(MOCK_SUCCESS);             // retry 3 succeeds

    const result = await chat({
      role: 'reviewer', // maxRetries: 2 → up to 3 attempts
      messages: [{ role: 'user', content: 'Review' }],
    });

    expect(mockPost).toHaveBeenCalledTimes(3);
    expect(result.provider).toBe('flock'); // stayed on primary provider
  });
});

// ─── Fallback Behaviour ───────────────────────────────────────────────────────

describe('fallback behaviour', () => {
  // generator: maxRetries: 1 → 2 primary attempts before fallback.

  it('falls back to Venice after exhausting primary retries on 503', async () => {
    mockRejectN(makeAxiosHttpError(503), 2); // exhaust 2 primary attempts
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS); // Venice succeeds

    const result = await chat({
      role: 'generator',
      messages: [{ role: 'user', content: 'Fix bug' }],
    });

    expect(mockPost).toHaveBeenCalledTimes(3);
    const [fallbackUrl] = mockPost.mock.calls[2]; // 3rd call = Venice
    expect(fallbackUrl).toContain('venice');
    expect(result.provider).toBe('venice');
  });

  it('does NOT fall back on a plain RouterError (not in fallbackOn)', async () => {
    mockPost.mockRejectedValueOnce(new Error('unexpected token'));

    const err = await chat({
      role: 'generator',
      messages: [{ role: 'user', content: 'Fix bug' }],
    }).catch((e) => e);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(RouterError);
  });

  it('falls back to Venice after exhausting primary retries on HTTP error', async () => {
    mockRejectN(makeAxiosHttpError(503), 2);
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS);

    const result = await chat({
      role: 'generator',
      messages: [{ role: 'user', content: 'Fix bug' }],
    });

    expect(result.provider).toBe('venice');
  });

  it('falls back to Venice after exhausting primary retries on timeout', async () => {
    mockRejectN(makeAxiosTimeoutError(), 2);
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS);

    const result = await chat({
      role: 'generator',
      messages: [{ role: 'user', content: 'Fix bug' }],
    });

    expect(result.provider).toBe('venice');
  });

  it('throws the fallback error when both primary retries and fallback all fail', async () => {
    mockRejectN(makeAxiosHttpError(503), 2);          // exhausts primary
    mockPost.mockRejectedValueOnce(makeAxiosHttpError(503)); // fallback also fails

    const err = await chat({
      role: 'generator',
      messages: [{ role: 'user', content: 'Fix bug' }],
    }).catch((e) => e);

    expect(mockPost).toHaveBeenCalledTimes(3);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err.provider).toBe('venice');
    expect(err.statusCode).toBe(503);
  });

  it('does not attempt fallback for reviewer — exhausts retries then throws', async () => {
    // reviewer has no fallback config. It retries maxRetries:2 times then throws.
    mockRejectN(makeAxiosHttpError(503), 3);

    await expect(
      chat({ role: 'reviewer', messages: [{ role: 'user', content: 'Review' }] }),
    ).rejects.toBeInstanceOf(ProviderHttpError);

    expect(mockPost).toHaveBeenCalledTimes(3);
  });

  it('does not attempt fallback for planner — exhausts retries then throws', async () => {
    // planner has no fallback config. maxRetries:1 → 2 total attempts.
    mockRejectN(makeAxiosHttpError(500), 2);

    await expect(
      chat({ role: 'planner', messages: [{ role: 'user', content: 'Plan' }] }),
    ).rejects.toBeInstanceOf(ProviderHttpError);

    expect(mockPost).toHaveBeenCalledTimes(2);
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

  it('throws when VENICE_API_KEY is missing after fallback is triggered', async () => {
    delete process.env.VENICE_API_KEY;
    // Exhaust generator's 2 primary attempts (503 in fallbackOn), then
    // the fallback call to Venice throws missing key error.
    mockRejectN(makeAxiosHttpError(503), 2);

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
    mockPost
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: 'reply-1' } }], usage: { total_tokens: 1 } } })
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: 'reply-2' } }], usage: { total_tokens: 2 } } })
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: 'reply-3' } }], usage: { total_tokens: 3 } } });

    const [r1, r2, r3] = await Promise.all([
      chat({ role: 'generator',    messages: [{ role: 'user', content: 'A' }], requestId: 'req-1' }),
      chat({ role: 'reviewer',     messages: [{ role: 'user', content: 'B' }], requestId: 'req-2' }),
      chat({ role: 'orchestrator', messages: [{ role: 'user', content: 'C' }], requestId: 'req-3' }),
    ]);

    expect(r1.content).toBe('reply-1');
    expect(r2.content).toBe('reply-2');
    expect(r3.content).toBe('reply-3');
    expect(mockPost).toHaveBeenCalledTimes(3);
  });

  it('isolates failures — one failing call does not affect others', async () => {
    // Use 401 for reviewer so it fails immediately with no retries
    // (401 is not in reviewer's fallbackOn), keeping the mock queue simple.
    mockPost
      .mockRejectedValueOnce(makeAxiosHttpError(401)) // reviewer fails, no retry
      .mockResolvedValueOnce(MOCK_SUCCESS);            // planner succeeds

    const [err, result] = await Promise.allSettled([
      chat({ role: 'reviewer', messages: [{ role: 'user', content: 'Review' }] }),
      chat({ role: 'planner',  messages: [{ role: 'user', content: 'Plan' }] }),
    ]);

    expect(err.status).toBe('rejected');
    expect(result.status).toBe('fulfilled');
  });
});
