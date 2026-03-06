/**
 * api.test.ts
 *
 * Integration tests for the CEOClaw REST API.
 * All Supabase calls and loop side-effects are mocked.
 */

import request from 'supertest';

// ─── Mock all external dependencies before importing the app ─────────────────

jest.mock('../src/founderStore', () => ({
    loadBusinessState: jest.fn().mockResolvedValue({
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
    }),
    patchBusinessState: jest.fn().mockImplementation(async (patch: any) => ({ ...patch })),
    setLoopEnabled: jest.fn().mockResolvedValue(undefined),
    appendTaskLog: jest.fn().mockResolvedValue(undefined),
    updateTaskLog: jest.fn().mockResolvedValue(undefined),
    getRecentCompletedTaskTypes: jest.fn().mockResolvedValue([]),
    getTaskHistory: jest.fn().mockResolvedValue([]),
}));

jest.mock('../src/founderLoop', () => ({
    startLoop: jest.fn().mockResolvedValue(undefined),
    stopLoop: jest.fn().mockResolvedValue(undefined),
    runOneIteration: jest.fn().mockResolvedValue({
        taskId: 'task-123',
        taskType: 'operations.analyze_metrics',
        domain: 'operations',
        status: 'completed',
        reason: 'mocked iteration',
        priority: 'medium',
        mrrAtTime: 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
    }),
    getLoopStatus: jest.fn().mockResolvedValue({
        running: false,
        intervalMs: 3600000,
        iterationsRun: 0,
        currentMrr: 0,
        mrrGoal: 100,
        mrrProgress: '0%',
        phase: 'pre-launch',
    }),
    runTaskByType: jest.fn().mockResolvedValue({
        taskId: 'task-direct-1',
        taskType: 'operations.analyze_metrics',
        domain: 'operations',
        status: 'completed',
        reason: 'direct run',
        priority: 'high',
        mrrAtTime: 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
    }),
}));

jest.mock('../src/campaignManager', () => ({
    createCampaign: jest.fn().mockResolvedValue({
        campaignId: 'camp-1',
        name: 'Test Campaign',
        status: 'draft',
    }),
    runCampaign: jest.fn().mockResolvedValue({ messagesSent: 0 }),
    resumeCampaignSending: jest.fn().mockResolvedValue({ messagesSent: 0 }),
    getCampaignProgressPath: jest.fn().mockReturnValue('/tmp/campaign-progress.json'),
}));

jest.mock('../src/prospectStore', () => ({
    getCampaign: jest.fn().mockResolvedValue({
        campaignId: 'camp-1',
        name: 'Test Campaign',
        status: 'draft',
    }),
    listCampaigns: jest.fn().mockResolvedValue([]),
    getProspectsByCampaign: jest.fn().mockResolvedValue([]),
    updateCampaignStatus: jest.fn().mockResolvedValue(undefined),
}));

import app from '../src/index';
import { runOneIteration, startLoop, stopLoop, getLoopStatus, runTaskByType } from '../src/founderLoop';
import { loadBusinessState, patchBusinessState, getTaskHistory } from '../src/founderStore';
import { createCampaign, runCampaign } from '../src/campaignManager';

// ─── Health ───────────────────────────────────────────────────────────────────

describe('GET /health', () => {
    it('returns 200 ok', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.service).toBe('ceoclaw-founder');
    });
});

// ─── Loop status ──────────────────────────────────────────────────────────────

describe('GET /api/loop/status', () => {
    it('returns loop status with MRR progress', async () => {
        const res = await request(app).get('/api/loop/status');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.loop).toBeDefined();
        expect(typeof res.body.loop.running).toBe('boolean');
        expect(res.body.loop.mrrGoal).toBe(100);
        expect(res.body.loop.mrrProgress).toBe('0%');
    });
});

// ─── Loop start / stop ────────────────────────────────────────────────────────

describe('POST /api/loop/start', () => {
    it('starts the loop and returns success', async () => {
        const res = await request(app).post('/api/loop/start');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(startLoop).toHaveBeenCalledTimes(1);
    });
});

describe('POST /api/loop/stop', () => {
    it('stops the loop and returns success', async () => {
        const res = await request(app).post('/api/loop/stop');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(stopLoop).toHaveBeenCalledTimes(1);
    });
});

// ─── Manual tick ─────────────────────────────────────────────────────────────

describe('POST /api/loop/tick', () => {
    it('runs one iteration and returns the task record', async () => {
        const res = await request(app).post('/api/loop/tick');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.task.taskType).toBe('operations.analyze_metrics');
        expect(res.body.task.status).toBe('completed');
        expect(runOneIteration).toHaveBeenCalledTimes(1);
    });
});

describe('POST /api/dev/task/run', () => {
    it('runs the explicit task type with optional overrides', async () => {
        const res = await request(app).post('/api/dev/task/run').send({
            taskType: 'operations.analyze_metrics',
            reason: 'Manual validation',
            priority: 'high',
            stateOverrides: { mrr: 42, totalSignups: 10 },
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.task.taskType).toBe('operations.analyze_metrics');
        expect(runTaskByType).toHaveBeenCalledWith(
            'operations.analyze_metrics',
            expect.objectContaining({
                reason: 'Manual validation',
                priority: 'high',
                stateOverrides: expect.objectContaining({ mrr: 42, totalSignups: 10 }),
            })
        );
    });

    it('returns 400 for invalid task type', async () => {
        const res = await request(app).post('/api/dev/task/run').send({ taskType: 'sales.invalid' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid taskType');
    });

    it('returns 400 for invalid priority', async () => {
        const res = await request(app).post('/api/dev/task/run').send({
            taskType: 'operations.analyze_metrics',
            priority: 'urgent',
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid priority');
    });
});

// ─── Loop history ─────────────────────────────────────────────────────────────

describe('GET /api/loop/history', () => {
    it('returns task history array', async () => {
        const res = await request(app).get('/api/loop/history?limit=10');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.history)).toBe(true);
        expect(getTaskHistory).toHaveBeenCalledWith(10);
    });

    it('caps limit at 200', async () => {
        await request(app).get('/api/loop/history?limit=999');
        expect(getTaskHistory).toHaveBeenCalledWith(200);
    });
});

// ─── Business state ──────────────────────────────────────────────────────────

describe('GET /api/state', () => {
    it('returns current business state', async () => {
        const res = await request(app).get('/api/state');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.state.mrr).toBe(0);
        expect(res.body.state.phase).toBe('pre-launch');
    });
});

describe('PATCH /api/state', () => {
    it('patches MRR and signups', async () => {
        const res = await request(app).patch('/api/state').send({ mrr: 29, totalSignups: 3 });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(patchBusinessState).toHaveBeenCalledWith(
            expect.objectContaining({ mrr: 29, totalSignups: 3 })
        );
    });

    it('ignores unknown fields and returns state', async () => {
        const res = await request(app).patch('/api/state').send({ unknownField: 'value' });
        expect(res.status).toBe(200);
        expect(patchBusinessState).toHaveBeenCalledWith({});
    });
});

// ─── Campaign API ─────────────────────────────────────────────────────────────

describe('POST /api/campaign', () => {
    it('creates a campaign with required fields', async () => {
        const res = await request(app).post('/api/campaign').send({
            name: 'Test Campaign',
            searchQuery: 'CTO startup',
        });
        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(createCampaign).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Test Campaign', searchQuery: 'CTO startup' })
        );
    });

    it('returns 400 when name or searchQuery is missing', async () => {
        const res = await request(app).post('/api/campaign').send({ name: 'Missing query' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('name');
    });
});

describe('GET /api/campaign', () => {
    it('returns campaign list', async () => {
        const res = await request(app).get('/api/campaign');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.campaigns)).toBe(true);
    });
});

describe('POST /api/campaign/:id/run', () => {
    it('accepts optional stage timebox options', async () => {
        const res = await request(app).post('/api/campaign/camp-1/run').send({
            discoveryTimeboxMs: 60_000,
            qualificationTimeboxMs: 45_000,
            messageTimeboxMs: 30_000,
            sendingTimeboxMs: 25_000,
        });

        expect(res.status).toBe(202);
        expect(res.body.success).toBe(true);
        expect(res.body.progressFile).toBe('/tmp/campaign-progress.json');
        expect(runCampaign).toHaveBeenCalledWith(
            'camp-1',
            expect.objectContaining({
                discoveryTimeboxMs: 60000,
                qualificationTimeboxMs: 45000,
                messageTimeboxMs: 30000,
                sendingTimeboxMs: 25000,
            })
        );
    });

    it('rejects invalid timebox values', async () => {
        const badDiscovery = await request(app).post('/api/campaign/camp-1/run').send({
            discoveryTimeboxMs: 'abc',
        });
        expect(badDiscovery.status).toBe(400);
        expect(badDiscovery.body.error).toContain('discoveryTimeboxMs');

        const badQualification = await request(app).post('/api/campaign/camp-1/run').send({
            qualificationTimeboxMs: -1,
        });
        expect(badQualification.status).toBe(400);
        expect(badQualification.body.error).toContain('qualificationTimeboxMs');

        const badMessage = await request(app).post('/api/campaign/camp-1/run').send({
            messageTimeboxMs: '0',
        });
        expect(badMessage.status).toBe(400);
        expect(badMessage.body.error).toContain('messageTimeboxMs');

        const badSending = await request(app).post('/api/campaign/camp-1/run').send({
            sendingTimeboxMs: 'abc',
        });
        expect(badSending.status).toBe(400);
        expect(badSending.body.error).toContain('sendingTimeboxMs');
    });
});
