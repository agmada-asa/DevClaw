/**
 * taskRouter.test.ts
 *
 * Tests for CEOClaw's task routing logic — the GLM-powered brain that decides
 * which task has the highest leverage toward $100 MRR.
 *
 * All LLM calls are mocked; this suite tests routing logic, JSON parsing,
 * fallback behaviour, and the new direct GLM mode.
 */

import { BusinessState, MRR_GOAL } from '../src/founderTypes';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeState = (overrides: Partial<BusinessState> = {}): BusinessState => ({
    mrr: 0,
    totalSignups: 0,
    activeUsers: 0,
    trafficLast30d: 0,
    landingPageUrl: undefined,
    tasksCompletedToday: 0,
    tasksCompletedTotal: 0,
    loopEnabled: false,
    phase: 'pre-launch',
    updatedAt: new Date().toISOString(),
    ...overrides,
});

// ─── Mock @devclaw/llm-router before importing the module under test ──────────

jest.mock('@devclaw/llm-router', () => ({
    chat: jest.fn(),
}));

// Mock openclawRunner so the openclaw mode doesn't actually exec a CLI binary
jest.mock('../src/openclawRunner', () => ({
    runOpenClawPrompt: jest.fn(),
    extractJsonObject: jest.requireActual('../src/openclawRunner').extractJsonObject,
}));

import { chat } from '@devclaw/llm-router';
import { runOpenClawPrompt } from '../src/openclawRunner';
import { routeNextTask } from '../src/taskRouter';

const mockChat = chat as jest.MockedFunction<typeof chat>;
const mockCli = runOpenClawPrompt as jest.MockedFunction<typeof runOpenClawPrompt>;

const validRoutingJson = (task: string, domain: string, reason = 'test reason', priority = 'high') =>
    JSON.stringify({ task, domain, reason, priority });

beforeEach(() => {
    jest.clearAllMocks();
    process.env.CEOCLAW_AGENT_ENGINE = 'direct';
    process.env.ZAI_API_KEY = 'test-key';
    process.env.OPENROUTER_API_KEY = 'test-or-key';
});

// ─── Direct GLM mode ─────────────────────────────────────────────────────────

describe('direct mode — Z.AI GLM routing', () => {
    it('calls the orchestrator role via llm-router', async () => {
        mockChat.mockResolvedValueOnce({
            content: validRoutingJson('marketing.write_seo_content', 'marketing'),
            model: 'glm-z1-flash',
            provider: 'zai',
        });

        const result = await routeNextTask(makeState(), []);

        expect(mockChat).toHaveBeenCalledWith(
            expect.objectContaining({ role: 'orchestrator' })
        );
        expect(result.taskType).toBe('marketing.write_seo_content');
        expect(result.domain).toBe('marketing');
        expect(result.priority).toBe('high');
    });

    it('routes to all valid task types without error', async () => {
        const taskTypes = [
            'product.generate_idea',
            'product.build_landing_page',
            'marketing.write_seo_content',
            'marketing.plan_campaign',
            'sales.find_prospects',
            'sales.send_outreach',
            'operations.analyze_metrics',
            'operations.process_feedback',
            'operations.plan_iteration',
        ] as const;

        for (const taskType of taskTypes) {
            jest.clearAllMocks();
            const domain = taskType.split('.')[0] as any;
            mockChat.mockResolvedValueOnce({
                content: validRoutingJson(taskType, domain),
                model: 'glm-z1-flash',
                provider: 'zai',
            });
            const result = await routeNextTask(makeState(), []);
            expect(result.taskType).toBe(taskType);
        }
    });

    it('falls back to heuristic when GLM returns malformed JSON', async () => {
        mockChat.mockResolvedValueOnce({
            content: 'Sorry, I cannot help with that.',
            model: 'glm-z1-flash',
            provider: 'zai',
        });

        const result = await routeNextTask(makeState(), []);
        // Heuristic: no landing page → build one first
        expect(result.taskType).toBe('product.build_landing_page');
        expect(result.domain).toBe('product');
    });

    it('falls back to heuristic when GLM call throws', async () => {
        mockChat.mockRejectedValueOnce(new Error('ZAI timeout'));

        const state = makeState({ landingPageUrl: 'https://devclaw.ai', trafficLast30d: 10 });
        const result = await routeNextTask(state, []);
        // Heuristic: low traffic → write SEO content
        expect(result.taskType).toBe('marketing.write_seo_content');
    });

    it('falls back to operations.analyze_metrics for unrecognised task type', async () => {
        mockChat.mockResolvedValueOnce({
            content: validRoutingJson('completely.unknown_task', 'operations'),
            model: 'glm-z1-flash',
            provider: 'zai',
        });

        const result = await routeNextTask(makeState({ landingPageUrl: 'https://devclaw.ai' }), []);
        expect(result.taskType).toBe('operations.analyze_metrics');
    });
});

// ─── OpenClaw CLI mode ────────────────────────────────────────────────────────

describe('openclaw mode — CLI routing', () => {
    beforeEach(() => {
        process.env.CEOCLAW_AGENT_ENGINE = 'openclaw';
    });

    it('calls the openclaw CLI runner', async () => {
        mockCli.mockResolvedValueOnce(
            validRoutingJson('sales.find_prospects', 'sales', 'MRR is 0', 'high')
        );

        const result = await routeNextTask(makeState({ landingPageUrl: 'https://devclaw.ai' }), []);

        expect(mockCli).toHaveBeenCalledTimes(1);
        expect(mockChat).not.toHaveBeenCalled();
        expect(result.taskType).toBe('sales.find_prospects');
    });

    it('falls back to heuristic when CLI fails', async () => {
        mockCli.mockRejectedValueOnce(new Error('CLI binary not found'));

        // trafficLast30d >= 100 to bypass the SEO heuristic and reach the sales check
        const state = makeState({ landingPageUrl: 'https://devclaw.ai', trafficLast30d: 200, mrr: 0, totalSignups: 5 });
        const result = await routeNextTask(state, []);

        expect(result.taskType).toBe('sales.find_prospects');
        expect(result.domain).toBe('sales');
    });
});

// ─── Heuristic mode ───────────────────────────────────────────────────────────

describe('heuristic mode — no AI', () => {
    beforeEach(() => {
        process.env.CEOCLAW_AGENT_ENGINE = 'heuristic';
    });

    it('prioritises building landing page when none exists', async () => {
        const result = await routeNextTask(makeState(), []);
        expect(result.taskType).toBe('product.build_landing_page');
        expect(result.priority).toBe('high');
    });

    it('prioritises SEO content when traffic is low', async () => {
        const state = makeState({ landingPageUrl: 'https://devclaw.ai', trafficLast30d: 50 });
        const result = await routeNextTask(state, []);
        expect(result.taskType).toBe('marketing.write_seo_content');
    });

    it('does not repeat the last SEO task when traffic is low', async () => {
        const state = makeState({ landingPageUrl: 'https://devclaw.ai', trafficLast30d: 50 });
        // Last task was SEO — should not repeat
        const result = await routeNextTask(state, ['marketing.write_seo_content']);
        expect(result.taskType).not.toBe('marketing.write_seo_content');
    });

    it('pushes sales when MRR is 0 but signups exist', async () => {
        const state = makeState({ landingPageUrl: 'https://devclaw.ai', trafficLast30d: 500, mrr: 0, totalSignups: 3 });
        const result = await routeNextTask(state, []);
        expect(result.taskType).toBe('sales.find_prospects');
    });

    it('rotates tasks to avoid repetition', async () => {
        process.env.CEOCLAW_AGENT_ENGINE = 'heuristic';
        const state = makeState({ landingPageUrl: 'https://devclaw.ai', trafficLast30d: 200, mrr: 10, totalSignups: 2 });
        const recentTasks = ['sales.find_prospects'];
        const result = await routeNextTask(state, recentTasks);
        expect(result.taskType).not.toBe('sales.find_prospects');
    });
});

// ─── JSON parsing edge cases ─────────────────────────────────────────────────

describe('JSON parsing edge cases', () => {
    it('extracts JSON wrapped in markdown code fences', async () => {
        process.env.CEOCLAW_AGENT_ENGINE = 'direct';
        mockChat.mockResolvedValueOnce({
            content: '```json\n' + validRoutingJson('product.generate_idea', 'product') + '\n```',
            model: 'glm-z1-flash',
            provider: 'zai',
        });

        const result = await routeNextTask(makeState({ landingPageUrl: 'https://x.com' }), []);
        expect(result.taskType).toBe('product.generate_idea');
    });

    it('extracts JSON with surrounding prose text', async () => {
        process.env.CEOCLAW_AGENT_ENGINE = 'direct';
        mockChat.mockResolvedValueOnce({
            content: 'Based on the current state, I recommend: ' + validRoutingJson('operations.analyze_metrics', 'operations'),
            model: 'glm-z1-flash',
            provider: 'zai',
        });

        const result = await routeNextTask(makeState({ landingPageUrl: 'https://x.com', trafficLast30d: 500 }), []);
        expect(result.taskType).toBe('operations.analyze_metrics');
    });

    it('defaults priority to medium when GLM omits it', async () => {
        process.env.CEOCLAW_AGENT_ENGINE = 'direct';
        mockChat.mockResolvedValueOnce({
            content: JSON.stringify({ task: 'product.generate_idea', domain: 'product', reason: 'test' }),
            model: 'glm-z1-flash',
            provider: 'zai',
        });

        const result = await routeNextTask(makeState({ landingPageUrl: 'https://x.com' }), []);
        expect(result.priority).toBe('medium');
    });
});

// ─── MRR goal constant ────────────────────────────────────────────────────────

describe('MRR_GOAL constant', () => {
    it('is set to $100', () => {
        expect(MRR_GOAL).toBe(100);
    });
});
