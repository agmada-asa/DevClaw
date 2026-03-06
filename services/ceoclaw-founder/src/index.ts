import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

// ─── Founder Loop (core agent) ────────────────────────────────────────────────
import { startLoop, stopLoop, getLoopStatus, runOneIteration, runTaskByType } from './founderLoop';
import { loadBusinessState, patchBusinessState, getTaskHistory } from './founderStore';
import { TaskType, TaskPriority } from './founderTypes';

// ─── Campaign API (sales domain) ─────────────────────────────────────────────
import { createCampaign, runCampaign, resumeCampaignSending, getCampaignProgressPath } from './campaignManager';
import { getCampaign, listCampaigns, getProspectsByCampaign, updateCampaignStatus } from './prospectStore';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const port = process.env.PORT || 3050;

const TASK_TYPES = new Set<TaskType>([
    'product.generate_idea',
    'product.build_landing_page',
    'marketing.write_seo_content',
    'marketing.plan_campaign',
    'sales.find_prospects',
    'sales.send_outreach',
    'sales.follow_up',
    'operations.analyze_metrics',
    'operations.process_feedback',
    'operations.plan_iteration',
]);

const TASK_PRIORITIES: TaskPriority[] = ['high', 'medium', 'low'];

app.use(cors());
app.use(express.json());

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        service: 'ceoclaw-founder',
        agentEngine: process.env.CEOCLAW_AGENT_ENGINE || 'openclaw',
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FOUNDER LOOP API  — controls the autonomous agent
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/loop/status
app.get('/api/loop/status', async (_req: Request, res: Response): Promise<any> => {
    try {
        const status = await getLoopStatus();
        return res.status(200).json({ success: true, loop: status });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

// POST /api/loop/start — start the autonomous founder loop
app.post('/api/loop/start', async (_req: Request, res: Response): Promise<any> => {
    try {
        await startLoop();
        const status = await getLoopStatus();
        return res.status(200).json({
            success: true,
            message: '🚀 CEOClaw founder loop started. The AI is now working toward $100 MRR.',
            loop: status,
        });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

// POST /api/loop/stop
app.post('/api/loop/stop', async (_req: Request, res: Response): Promise<any> => {
    try {
        await stopLoop();
        return res.status(200).json({ success: true, message: 'Founder loop stopped.' });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

// POST /api/loop/tick — manually trigger one iteration (demos + testing)
app.post('/api/loop/tick', async (_req: Request, res: Response): Promise<any> => {
    try {
        console.log('[CEOClaw] Manual tick triggered via API');
        const taskRecord = await runOneIteration();
        return res.status(200).json({
            success: true,
            message: `Executed: ${taskRecord.taskType} (${taskRecord.status})`,
            task: taskRecord,
        });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

// POST /api/dev/task/run — deterministic, explicit task execution for dev/test
app.post('/api/dev/task/run', async (req: Request, res: Response): Promise<any> => {
    const { taskType, stateOverrides, reason, priority } = req.body || {};

    if (typeof taskType !== 'string' || !TASK_TYPES.has(taskType as TaskType)) {
        return res.status(400).json({
            error: 'Invalid taskType',
            validTaskTypes: Array.from(TASK_TYPES),
        });
    }

    if (priority !== undefined && (typeof priority !== 'string' || !TASK_PRIORITIES.includes(priority as TaskPriority))) {
        return res.status(400).json({
            error: 'Invalid priority',
            validPriorities: TASK_PRIORITIES,
        });
    }

    try {
        const taskRecord = await runTaskByType(taskType as TaskType, {
            stateOverrides: typeof stateOverrides === 'object' && stateOverrides !== null
                ? stateOverrides
                : undefined,
            reason: typeof reason === 'string' ? reason : undefined,
            priority: typeof priority === 'string' ? (priority as TaskPriority) : undefined,
        });

        return res.status(200).json({
            success: true,
            message: `Executed explicit task: ${taskRecord.taskType} (${taskRecord.status})`,
            task: taskRecord,
        });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

// GET /api/loop/history — task execution log
app.get('/api/loop/history', async (req: Request, res: Response): Promise<any> => {
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 200);
    try {
        const history = await getTaskHistory(limit);
        return res.status(200).json({ success: true, count: history.length, history });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUSINESS STATE API
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/state
app.get('/api/state', async (_req: Request, res: Response): Promise<any> => {
    try {
        const state = await loadBusinessState();
        return res.status(200).json({ success: true, state });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

// PATCH /api/state — feed in real metrics (Stripe MRR, analytics, signups, etc.)
app.patch('/api/state', async (req: Request, res: Response): Promise<any> => {
    const { mrr, totalSignups, activeUsers, trafficLast30d, landingPageUrl, latestIdea, phase } = req.body || {};
    try {
        const updated = await patchBusinessState({
            ...(mrr !== undefined && { mrr: Number(mrr) }),
            ...(totalSignups !== undefined && { totalSignups: Number(totalSignups) }),
            ...(activeUsers !== undefined && { activeUsers: Number(activeUsers) }),
            ...(trafficLast30d !== undefined && { trafficLast30d: Number(trafficLast30d) }),
            ...(landingPageUrl !== undefined && { landingPageUrl: String(landingPageUrl) }),
            ...(latestIdea !== undefined && { latestIdea: String(latestIdea) }),
            ...(phase !== undefined && { phase }),
        });
        return res.status(200).json({ success: true, state: updated });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CAMPAIGN API  — LinkedIn sales campaigns
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/campaign', async (req: Request, res: Response): Promise<any> => {
    const { name, searchQuery, targetIndustries, targetCompanySizes, targetTitles, maxProspects, minFitScore } = req.body || {};
    if (!name || !searchQuery) return res.status(400).json({ error: 'Missing required fields: name, searchQuery' });
    try {
        const campaign = await createCampaign({ name, searchQuery, targetIndustries, targetCompanySizes, targetTitles, maxProspects, minFitScore });
        return res.status(201).json({ success: true, campaign });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

app.get('/api/campaign', async (_req: Request, res: Response): Promise<any> => {
    try {
        const campaigns = await listCampaigns();
        return res.status(200).json({ success: true, campaigns });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

app.get('/api/campaign/:id', async (req: Request, res: Response): Promise<any> => {
    const campaign = await getCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    return res.status(200).json({ success: true, campaign });
});

app.post('/api/campaign/:id/run', async (req: Request, res: Response): Promise<any> => {
    const campaignId = req.params.id;
    const {
        discoveryTimeboxMs,
        qualificationTimeboxMs,
        messageTimeboxMs,
        sendingTimeboxMs,
    } = req.body || {};
    const campaign = await getCampaign(campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status === 'running') return res.status(409).json({ error: 'Campaign already running' });

    const parseOptionalPositiveInt = (value: unknown): number | undefined => {
        if (value === undefined || value === null || value === '') return undefined;
        const parsed = Number.parseInt(String(value), 10);
        if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
        return parsed;
    };

    const parsedDiscoveryTimeboxMs = parseOptionalPositiveInt(discoveryTimeboxMs);
    const parsedQualificationTimeboxMs = parseOptionalPositiveInt(qualificationTimeboxMs);
    const parsedMessageTimeboxMs = parseOptionalPositiveInt(messageTimeboxMs);
    const parsedSendingTimeboxMs = parseOptionalPositiveInt(sendingTimeboxMs);

    if (discoveryTimeboxMs !== undefined && parsedDiscoveryTimeboxMs === undefined) {
        return res.status(400).json({ error: 'Invalid discoveryTimeboxMs (must be positive integer milliseconds)' });
    }
    if (qualificationTimeboxMs !== undefined && parsedQualificationTimeboxMs === undefined) {
        return res.status(400).json({ error: 'Invalid qualificationTimeboxMs (must be positive integer milliseconds)' });
    }
    if (messageTimeboxMs !== undefined && parsedMessageTimeboxMs === undefined) {
        return res.status(400).json({ error: 'Invalid messageTimeboxMs (must be positive integer milliseconds)' });
    }
    if (sendingTimeboxMs !== undefined && parsedSendingTimeboxMs === undefined) {
        return res.status(400).json({ error: 'Invalid sendingTimeboxMs (must be positive integer milliseconds)' });
    }

    const runOptions = {
        ...(parsedDiscoveryTimeboxMs !== undefined && { discoveryTimeboxMs: parsedDiscoveryTimeboxMs }),
        ...(parsedQualificationTimeboxMs !== undefined && { qualificationTimeboxMs: parsedQualificationTimeboxMs }),
        ...(parsedMessageTimeboxMs !== undefined && { messageTimeboxMs: parsedMessageTimeboxMs }),
        ...(parsedSendingTimeboxMs !== undefined && { sendingTimeboxMs: parsedSendingTimeboxMs }),
    };

    const progressFile = getCampaignProgressPath(campaignId);
    res.status(202).json({
        success: true,
        message: `Campaign "${campaign.name}" started.`,
        campaignId,
        progressFile,
        options: runOptions,
    });
    runCampaign(campaignId, runOptions)
        .then((r) => console.log(`[CEOClaw] Campaign ${campaignId}: sent=${r.messagesSent}`))
        .catch((err) => console.error(`[CEOClaw] Campaign ${campaignId} failed:`, err.message));
});

app.post('/api/campaign/:id/resume', async (req: Request, res: Response): Promise<any> => {
    const campaignId = req.params.id;
    const campaign = await getCampaign(campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    res.status(202).json({ success: true, message: `Resuming send for "${campaign.name}".`, campaignId });
    resumeCampaignSending(campaignId)
        .then((r) => console.log(`[CEOClaw] Resume: sent=${r.messagesSent}`))
        .catch((err) => console.error(`[CEOClaw] Resume failed:`, err.message));
});

app.post('/api/campaign/:id/pause', async (req: Request, res: Response): Promise<any> => {
    const campaign = await getCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    await updateCampaignStatus(req.params.id, 'paused');
    return res.status(200).json({ success: true, message: 'Campaign paused.' });
});

app.get('/api/campaign/:id/prospects', async (req: Request, res: Response): Promise<any> => {
    const prospects = await getProspectsByCampaign(req.params.id);
    const summary = {
        total: prospects.length,
        discovered: prospects.filter((p) => p.status === 'discovered').length,
        qualified: prospects.filter((p) => p.status === 'qualified').length,
        disqualified: prospects.filter((p) => p.status === 'disqualified').length,
        messageReady: prospects.filter((p) => p.status === 'message_ready').length,
        connectionSent: prospects.filter((p) => p.status === 'connection_sent').length,
        messaged: prospects.filter((p) => p.status === 'messaged').length,
        replied: prospects.filter((p) => p.status === 'replied').length,
    };
    return res.status(200).json({ success: true, summary, prospects });
});

// ─── Test Send (direct — bypasses discovery / qualification) ──────────────────

app.post('/api/test-send', async (req: Request, res: Response): Promise<any> => {
    const { profileUrl, firstName, lastName, message, connectionDegree } = req.body || {};
    if (!profileUrl || !message) {
        return res.status(400).json({ error: 'Missing required fields: profileUrl, message' });
    }
    const { sendOutreachBatch } = await import('./linkedinMessenger');
    try {
        const results = await sendOutreachBatch([{
            prospectId: `test-${Date.now()}`,
            profileUrl: String(profileUrl),
            message: String(message),
            firstName: String(firstName || 'there'),
            lastName: String(lastName || ''),
            connectionDegree: connectionDegree === '1st' ? '1st' : '2nd',
        }]);
        const r = results[0];
        return res.status(200).json({ success: r.sent, method: r.method, error: r.error ?? null });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

// ─── Server Boot ──────────────────────────────────────────────────────────────

if (require.main === module) {
    app.listen(port, () => {
        console.log(`[CEOClaw] Service listening on port ${port}`);
        console.log(`[CEOClaw] Agent engine:  ${process.env.CEOCLAW_AGENT_ENGINE || 'openclaw'}`);
        console.log(`[CEOClaw] Loop interval: ${process.env.CEOCLAW_LOOP_INTERVAL_MS || '3600000'}ms`);
        console.log(`[CEOClaw] Auto-start:    ${process.env.CEOCLAW_AUTO_START || 'false'}`);
        console.log('[CEOClaw] POST /api/loop/start to begin the founder agent loop');
    });
}

export default app;
