import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { getOpenClawPlanningEngine } from './openclawPlanningEngine';
import { getPlanStore } from './planStore';
import { OpenClawPlanRecord } from './types';

dotenv.config();

const app = express();
const port = process.env.PORT || 3040;

app.use(cors());
app.use(express.json());

const planningEngine = getOpenClawPlanningEngine();
const planStore = getPlanStore();

const normalizeSource = (value: unknown): string => {
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }
    return 'openclaw-engine-api';
};

const toPlanResponse = (record: OpenClawPlanRecord) => ({
    ...record.plan,
    revision: record.revision,
    source: record.source,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revisionHistory: record.revisionHistory,
    blueprint: record.blueprint,
});

app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        service: 'openclaw-engine',
        capabilities: ['plan.create', 'plan.update', 'plan.get'],
        runtime: 'openclaw-cli',
    });
});

app.post('/api/plan', async (req: Request, res: Response): Promise<any> => {
    const { requestId, userId, repo, description, issueNumber, source } = req.body || {};

    if (!requestId || !userId || !repo || !description) {
        return res.status(400).json({
            error: 'Missing required fields: requestId, userId, repo, description',
        });
    }

    try {
        const created = await planningEngine.createPlan({
            requestId: String(requestId),
            userId: String(userId),
            repo: String(repo),
            description: String(description),
            issueNumber: typeof issueNumber === 'number' ? issueNumber : undefined,
        });

        const saved = planStore.saveNewPlan({
            plan: created.plan,
            source: normalizeSource(source),
            blueprint: created.blueprint,
        });

        return res.status(200).json(toPlanResponse(saved));
    } catch (err: any) {
        const detail = err?.message || 'unknown error';
        console.error('[OpenClawEngine] Failed to create plan:', detail);
        return res.status(502).json({
            error: 'Failed to generate architecture plan via OpenClaw CLI',
            detail,
        });
    }
});

app.get('/api/plan/:planId', (req: Request, res: Response): any => {
    const planId = String(req.params.planId || '').trim();
    if (!planId) {
        return res.status(400).json({ error: 'Missing planId path parameter' });
    }

    const found = planStore.getPlan(planId);
    if (!found) {
        return res.status(404).json({ error: 'Plan not found' });
    }

    return res.status(200).json(toPlanResponse(found));
});

app.post('/api/plan/:planId/update', async (req: Request, res: Response): Promise<any> => {
    const planId = String(req.params.planId || '').trim();
    const { changeRequest, context, repo, source } = req.body || {};

    if (!planId) {
        return res.status(400).json({ error: 'Missing planId path parameter' });
    }

    if (!changeRequest || typeof changeRequest !== 'string' || !changeRequest.trim()) {
        return res.status(400).json({ error: 'Missing required field: changeRequest' });
    }

    const existing = planStore.getPlan(planId);
    if (!existing) {
        return res.status(404).json({ error: 'Plan not found' });
    }

    try {
        const updated = await planningEngine.updatePlan({
            existingPlan: existing.plan,
            repo: typeof repo === 'string' && repo.trim() ? repo.trim() : existing.blueprint.targetRepo,
            changeRequest: changeRequest.trim(),
            context: typeof context === 'string' ? context.trim() : undefined,
            existingBlueprint: existing.blueprint,
        });

        const saved = planStore.savePlanRevision({
            planId,
            plan: updated.plan,
            source: normalizeSource(source),
            reason: `Plan updated: ${changeRequest.trim().slice(0, 140)}`,
            blueprint: updated.blueprint,
        });

        if (!saved) {
            return res.status(404).json({ error: 'Plan not found' });
        }

        return res.status(200).json(toPlanResponse(saved));
    } catch (err: any) {
        const detail = err?.message || 'unknown error';
        console.error('[OpenClawEngine] Failed to update plan:', detail);
        return res.status(502).json({
            error: 'Failed to update architecture plan via OpenClaw CLI',
            detail,
        });
    }
});

app.post('/api/execute', (_req: Request, res: Response) => {
    return res.status(501).json({
        error: 'Execution pipeline is not implemented in openclaw-engine yet. Use planning endpoints under /api/plan.',
        status: 'planning_only',
    });
});

if (require.main === module) {
    app.listen(port, () => {
        console.log(`[OpenClawEngine] Service listening on port ${port}`);
    });
}

export default app;
