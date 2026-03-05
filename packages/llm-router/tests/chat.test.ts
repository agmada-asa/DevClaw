import axios from 'axios';
import { chat, ProviderHttpError, ProviderTimeoutError, RouterError } from '../src/index';

jest.mock('axios');
const mockPost = axios.post as jest.MockedFunction<typeof axios.post>;

// jest.mock('axios') also mocks isAxiosError, so restore the detection logic.
(axios.isAxiosError as unknown as jest.Mock).mockImplementation(
  (err: unknown) => (err as any)?.isAxiosError === true,
);

function createMockStream(content: string) {
  const payload = JSON.stringify({
    choices: [{ delta: { content } }],
  });
  const chunk = Buffer.from(`data: ${payload}\n\ndata: [DONE]\n\n`, 'utf-8');
  return {
    data: {
      async *[Symbol.asyncIterator]() {
        yield chunk;
      }
    }
  };
}

const MOCK_SUCCESS = createMockStream('mock reply');

function makeAxiosHttpError(status: number, data: unknown = {}) {
  const err = new Error(`Request failed with status code ${status}`) as any;
  err.isAxiosError = true;
  err.code = undefined;
  err.response = { status, data };
  return err;
}

function makeAxiosTimeoutError(code: 'ECONNABORTED' | 'ERR_CANCELED' = 'ECONNABORTED') {
  const err = new Error('timeout of 0ms exceeded') as any;
  err.isAxiosError = true;
  err.code = code;
  err.response = undefined;
  return err;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FLOCK_API_KEY = 'test-flock-key';
  process.env.ZAI_API_KEY = 'test-zai-key';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  process.env.VENICE_API_KEY = 'test-venice-key';
  process.env.FLOCK_DEEPSEEK_V32_MODEL = 'deepseek-ai/DeepSeek-V3.2';
  process.env.ZAI_GLM_REVIEWER_MODEL = 'glm-4.6';
});

describe('role routing', () => {
  it('routes frontend_generator to FLock DeepSeek V3.2', async () => {
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS);

    const result = await chat({
      role: 'frontend_generator',
      messages: [{ role: 'user', content: 'Generate frontend patch' }],
    });

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toContain('bigmodel.cn');
    expect((body as any).model).toContain('glm-4.6');
    expect(result.provider).toBe('zai');
  });

  it('routes backend_generator to FLock', async () => {
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS);

    await chat({
      role: 'backend_generator',
      messages: [{ role: 'user', content: 'Generate backend patch' }],
    });

    const [url] = mockPost.mock.calls[0];
    expect(url).toContain('bigmodel.cn');
  });

  it('routes frontend_reviewer to OpenRouter GLM', async () => {
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS);

    await chat({
      role: 'frontend_reviewer',
      messages: [{ role: 'user', content: 'Review frontend patch' }],
    });

    const [url, body] = mockPost.mock.calls[0];
    expect(url).toContain('openrouter');
    expect((body as any).model).toContain('glm');
  });

  it('routes backend_reviewer to OpenRouter GLM', async () => {
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS);

    await chat({
      role: 'backend_reviewer',
      messages: [{ role: 'user', content: 'Review backend patch' }],
    });

    const [url, body] = mockPost.mock.calls[0];
    expect(url).toContain('openrouter');
    expect((body as any).model).toContain('glm');
  });

  it('keeps legacy generator/reviewer routes aligned', async () => {
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS).mockResolvedValueOnce(MOCK_SUCCESS);

    const legacyGenerator = await chat({
      role: 'generator',
      messages: [{ role: 'user', content: 'Legacy generator request' }],
    });
    const legacyReviewer = await chat({
      role: 'reviewer',
      messages: [{ role: 'user', content: 'Legacy reviewer request' }],
    });

    expect(legacyGenerator.provider).toBe('zai');
    expect(legacyReviewer.provider).toBe('openrouter');
  });
});

describe('request/response basics', () => {
  it('passes temperature and maxTokens through to provider calls', async () => {
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS);

    await chat({
      role: 'frontend_reviewer',
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0.3,
      maxTokens: 777,
    });

    const [, body] = mockPost.mock.calls[0];
    expect((body as any).temperature).toBe(0.3);
    expect((body as any).max_tokens).toBe(777);
  });

  it('returns content/model/provider/tokensUsed', async () => {
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS);

    const result = await chat({
      role: 'backend_reviewer',
      messages: [{ role: 'user', content: 'Review' }],
    });

    expect(result.content).toBe('mock reply');
    expect(typeof result.model).toBe('string');
    expect(result.provider).toBe('openrouter');
    expect(result.tokensUsed).toBeUndefined();
  });
});

describe('typed errors', () => {
  it('throws ProviderHttpError on HTTP failures', async () => {
    mockPost.mockRejectedValue(makeAxiosHttpError(500, { error: 'server down' }));

    const err = await chat({
      role: 'frontend_reviewer',
      messages: [{ role: 'user', content: 'Review this change' }],
      requestId: 'req-http-1',
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err).toBeInstanceOf(RouterError);
    expect(err.statusCode).toBe(500);
    expect(err.role).toBe('frontend_reviewer');
    expect(err.provider).toBe('zai');
    expect(err.requestId).toBe('req-http-1');
  });

  it('throws ProviderTimeoutError on timeout failures', async () => {
    mockPost.mockRejectedValue(makeAxiosTimeoutError());

    const err = await chat({
      role: 'backend_generator',
      messages: [{ role: 'user', content: 'Generate patch' }],
      requestId: 'req-timeout-1',
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ProviderTimeoutError);
    expect(err).toBeInstanceOf(RouterError);
    expect(err.role).toBe('backend_generator');
    expect(err.provider).toBe('zai');
    expect(err.requestId).toBe('req-timeout-1');
  });
});

describe('retry and fallback policy', () => {
  it('retries frontend_generator once on retryable failure and then succeeds', async () => {
    mockPost
      .mockRejectedValueOnce(makeAxiosHttpError(503))
      .mockResolvedValueOnce(MOCK_SUCCESS);

    const result = await chat({
      role: 'frontend_generator',
      messages: [{ role: 'user', content: 'Generate patch' }],
    });

    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(result.provider).toBe('zai');
  });

  it('retries reviewer according to maxRetries policy', async () => {
    mockPost
      .mockRejectedValueOnce(makeAxiosTimeoutError())
      .mockRejectedValueOnce(makeAxiosHttpError(500))
      .mockResolvedValueOnce(MOCK_SUCCESS);

    const result = await chat({
      role: 'backend_reviewer',
      messages: [{ role: 'user', content: 'Review patch' }],
    });

    // maxRetries=2 means up to 3 attempts total.
    expect(mockPost).toHaveBeenCalledTimes(3);
    expect(result.provider).toBe('openrouter');
  });

  it('never falls back generator calls to Venice when FLock fails', async () => {
    mockPost
      .mockRejectedValueOnce(makeAxiosHttpError(503))
      .mockRejectedValueOnce(makeAxiosHttpError(503))
      .mockRejectedValueOnce(makeAxiosHttpError(503))
      .mockRejectedValueOnce(makeAxiosHttpError(503));

    const err = await chat({
      role: 'backend_generator',
      messages: [{ role: 'user', content: 'Generate patch' }],
    }).catch((e) => e);

    expect(mockPost).toHaveBeenCalledTimes(4);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err.provider).toBe('zai');
  });
});

describe('environment variable guardrails', () => {
  it('throws when ZAI_API_KEY is missing for generator routes', async () => {
    delete process.env.ZAI_API_KEY;

    await expect(
      chat({
        role: 'frontend_generator',
        messages: [{ role: 'user', content: 'Generate patch' }],
      }),
    ).rejects.toThrow('ZAI_API_KEY is not set');
  });

  it('throws when OPENROUTER_API_KEY is missing for reviewer routes', async () => {
    delete process.env.OPENROUTER_API_KEY;

    await expect(
      chat({
        role: 'frontend_reviewer',
        messages: [{ role: 'user', content: 'Review patch' }],
      }),
    ).rejects.toThrow('OPENROUTER_API_KEY is not set');
  });
});

describe('unknown input handling', () => {
  it('throws for unknown role', async () => {
    await expect(
      chat({ role: 'unknown' as any, messages: [] }),
    ).rejects.toThrow('No model config for role');
  });

  it('passes through empty message arrays', async () => {
    mockPost.mockResolvedValueOnce(MOCK_SUCCESS);

    await expect(
      chat({ role: 'frontend_generator', messages: [] }),
    ).resolves.toBeDefined();

    const [, body] = mockPost.mock.calls[0];
    expect((body as any).messages).toEqual([]);
  });
});
