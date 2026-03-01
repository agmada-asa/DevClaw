import axios from 'axios';
import { ArchitecturePlan, IntakeRequest } from '@devclaw/contracts';

export interface PlanInput {
    intake: IntakeRequest;
    repoFullName: string;
    issueNumber: number;
}

export interface ExecuteInput {
    runId: string;
    planId?: string;
    requestId?: string;
    userId?: string;
    repo?: string;
    issueNumber?: number;
    issueUrl?: string;
    description?: string;
    planDetails?: ArchitecturePlan;
}

export interface ExecuteResult {
    dispatched: boolean;
    engine: 'legacy' | 'openclaw';
    runRef?: string;
}

export interface OrchestrationEngine {
    plan(input: PlanInput): Promise<ArchitecturePlan>;
    execute(input: ExecuteInput): Promise<ExecuteResult>;
}

class LegacyOrchestrationEngine implements OrchestrationEngine {
    async plan(input: PlanInput): Promise<ArchitecturePlan> {
        const plannerUrl = process.env.ARCHITECTURE_PLANNER_URL || 'http://localhost:3020';
        const plannerRes = await axios.post(`${plannerUrl}/api/plan`, {
            requestId: input.intake.requestId,
            userId: input.intake.userId,
            repo: input.repoFullName,
            description: input.intake.message,
            issueNumber: input.issueNumber,
        });
        return plannerRes.data;
    }

    async execute(input: ExecuteInput): Promise<ExecuteResult> {
        const runnerUrl = process.env.AGENT_RUNNER_URL || 'http://localhost:3030';
        const execRes = await axios.post(`${runnerUrl}/api/execute`, {
            runId: input.runId,
            planId: input.planId,
            requestId: input.requestId,
            userId: input.userId,
            repo: input.repo,
            issueNumber: input.issueNumber,
            issueUrl: input.issueUrl,
            description: input.description,
            plan: input.planDetails,
        });

        return {
            dispatched: true,
            engine: 'legacy',
            runRef: execRes.data?.runRef || input.runId,
        };
    }
}

class OpenClawOrchestrationEngine implements OrchestrationEngine {
    private readonly baseUrl = process.env.OPENCLAW_ENGINE_URL || 'http://localhost:3040';
    private readonly planPath = process.env.OPENCLAW_PLAN_PATH || '/api/plan';
    private readonly executePath = process.env.OPENCLAW_EXECUTE_PATH || '/api/execute';

    async plan(input: PlanInput): Promise<ArchitecturePlan> {
        const planRes = await axios.post(`${this.baseUrl}${this.planPath}`, {
            requestId: input.intake.requestId,
            userId: input.intake.userId,
            repo: input.repoFullName,
            description: input.intake.message,
            issueNumber: input.issueNumber,
            source: 'orchestrator',
        });
        return planRes.data;
    }

    async execute(input: ExecuteInput): Promise<ExecuteResult> {
        const execRes = await axios.post(`${this.baseUrl}${this.executePath}`, {
            runId: input.runId,
            planId: input.planId,
            requestId: input.requestId,
            userId: input.userId,
            repo: input.repo,
            issueNumber: input.issueNumber,
            issueUrl: input.issueUrl,
            description: input.description,
            plan: input.planDetails,
            source: 'orchestrator',
        });

        return {
            dispatched: true,
            engine: 'openclaw',
            runRef: execRes.data?.runRef || input.runId,
        };
    }
}

export const getOrchestrationEngine = (): OrchestrationEngine => {
    const engine = (process.env.ORCHESTRATION_ENGINE || 'legacy').toLowerCase();
    if (engine === 'openclaw') {
        return new OpenClawOrchestrationEngine();
    }
    return new LegacyOrchestrationEngine();
};
