import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { getOpenClawPlanningEngine } from './openclawPlanningEngine';
import { getPlanStore } from './planStore';
import { OpenClawPlanRecord } from './types';
import { getExecutionDispatcher } from './executionDispatcher';

dotenv.config();

const app = express();
const port = process.env.PORT || 3040;

app.use(cors());
app.use(express.json());

const planningEngine = getOpenClawPlanningEngine();
const planStore = getPlanStore();
const executionDispatcher = getExecutionDispatcher();

const toCompactJson = (value: unknown, fallback = 'n/a'): string => {
    if (value === undefined) return fallback;
    if (value === null) return 'null';
    if (typeof value === 'string') {
        return value.length > 500 ? `${value.slice(0, 500)}...(truncated)` : value;
    }
    try {
        const json = JSON.stringify(value);
        return json.length > 500 ? `${json.slice(0, 500)}...(truncated)` : json;
    } catch {
        return fallback;
    }
};

const formatExecutionError = (err: any): string => {
    if (!err) return 'unknown execution dispatch error';

    const details: string[] = [];
    const message = typeof err.message === 'string' ? err.message : String(err);
    details.push(`message=${message}`);

    if (typeof err.response?.status === 'number') details.push(`status=${err.response.status}`);
    if (typeof err.response?.statusText === 'string') details.push(`statusText=${err.response.statusText}`);
    if (typeof err.config?.url === 'string') details.push(`url=${err.config.url}`);
    if (err.response?.data !== undefined) details.push(`data=${toCompactJson(err.response.data)}`);

    return details.join(' | ');
};

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

/**
 * Health check endpoint.
 * Returns service capabilities and the underlying runtime (openclaw-cli).
 */
app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        service: 'openclaw-engine',
        capabilities: ['plan.create', 'plan.update', 'plan.get', 'execute.dispatch'],
        runtime: 'openclaw-cli',
    });
});

/**
 * POST /api/plan
 * 
 * Creates a new architecture plan.
 * Used by the orchestrator (via OpenClawPlanningEngine) to generate an 
 * initial blueprint for a task.
 */
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

        const saved = await planStore.saveNewPlan({
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

/**
 * GET /api/plan/:planId
 * 
 * Retrieves an existing plan from the local plan store.
 */
app.get('/api/plan/:planId', async (req: Request, res: Response): Promise<any> => {
    const planId = String(req.params.planId || '').trim();
    if (!planId) {
        return res.status(400).json({ error: 'Missing planId path parameter' });
    }

    const found = await planStore.getPlan(planId);
    if (!found) {
        return res.status(404).json({ error: 'Plan not found' });
    }

    return res.status(200).json(toPlanResponse(found));
});

/**
 * POST /api/plan/:planId/update
 * 
 * Iterates on an existing plan based on a user change request.
 * Useful for refining the architecture before approval and execution.
 */
app.post('/api/plan/:planId/update', async (req: Request, res: Response): Promise<any> => {
    const planId = String(req.params.planId || '').trim();
    const { changeRequest, context, repo, source } = req.body || {};

    if (!planId) {
        return res.status(400).json({ error: 'Missing planId path parameter' });
    }

    if (!changeRequest || typeof changeRequest !== 'string' || !changeRequest.trim()) {
        return res.status(400).json({ error: 'Missing required field: changeRequest' });
    }

    const existing = await planStore.getPlan(planId);
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

        const saved = await planStore.savePlanRevision({
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

/**
 * POST /api/execute
 * 
 * Dispatches execution to the agent-runner service while keeping OpenClaw
 * as the orchestration entrypoint for execution.
 */
app.post('/api/execute', async (req: Request, res: Response): Promise<any> => {
    const payload = req.body || {};
    const runId = typeof payload.runId === 'string' ? payload.runId.trim() : '';
    const source = typeof payload.source === 'string' ? payload.source.trim() : '';

    if (!runId) {
        return res.status(400).json({
            error: 'Missing required field: runId',
        });
    }

    if (source.toLowerCase() === 'agent-runner') {
        return res.status(409).json({
            error: 'Execution dispatch loop detected (agent-runner -> openclaw-engine -> agent-runner).',
            hint: 'Set RUNNER_ENGINE=stub or RUNNER_ENGINE=docker when orchestrator uses EXECUTION_ENGINE=openclaw.',
        });
    }

    try {
        const dispatch = await executionDispatcher.dispatch({
            ...payload,
            runId,
        });
        return res.status(202).json({
            success: true,
            status: 'dispatched',
            runRef: dispatch.runRef,
            engine: dispatch.engine,
            accepted: dispatch.accepted,
        });
    } catch (err: any) {
        const detail = formatExecutionError(err);
        console.error(`[OpenClawEngine] Failed to dispatch execution for runId=${runId}: ${detail}`);
        return res.status(502).json({
            error: 'Failed to dispatch execution run',
            detail,
        });
    }
});

if (require.main === module) {
    app.listen(port, () => {
        console.log(`[OpenClawEngine] Service listening on port ${port}`);
    });
}

export default app;
