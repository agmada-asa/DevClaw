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

class LegacyExecutionEngine {
    async execute(input: ExecuteInput): Promise<ExecuteResult> {
        console.log('================================================================================');
        console.log('🚀 Orchestrator is using LEGACY engine for execution');
        console.log('================================================================================');
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

class OpenClawPlanningEngine {
    private readonly baseUrl = process.env.OPENCLAW_ENGINE_URL || 'http://localhost:3040';
    private readonly planPath = process.env.OPENCLAW_PLAN_PATH || '/api/plan';

    async plan(input: PlanInput): Promise<ArchitecturePlan> {
        console.log('================================================================================');
        console.log('🚀 Orchestrator is using OPENCLAW engine for planning');
        console.log('================================================================================');
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
}

class OpenClawExecutionEngine {
    private readonly baseUrl = process.env.OPENCLAW_ENGINE_URL || 'http://localhost:3040';
    private readonly executePath = process.env.OPENCLAW_EXECUTE_PATH || '/api/execute';

    async execute(input: ExecuteInput): Promise<ExecuteResult> {
        console.log('================================================================================');
        console.log('🚀 Orchestrator is using OPENCLAW engine for execution');
        console.log('================================================================================');
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

class CombinedOrchestrationEngine implements OrchestrationEngine {
    constructor(
        private readonly planning: OpenClawPlanningEngine,
        private readonly execution: LegacyExecutionEngine | OpenClawExecutionEngine
    ) { }

    plan(input: PlanInput): Promise<ArchitecturePlan> {
        return this.planning.plan(input);
    }

    execute(input: ExecuteInput): Promise<ExecuteResult> {
        return this.execution.execute(input);
    }
}

export const getOrchestrationEngine = (): OrchestrationEngine => {
    const defaultEngine = (process.env.ORCHESTRATION_ENGINE || 'legacy').toLowerCase();
    const executionEngine = (process.env.EXECUTION_ENGINE || defaultEngine).toLowerCase();

    const planning = new OpenClawPlanningEngine();

    const execution = executionEngine === 'openclaw'
        ? new OpenClawExecutionEngine()
        : new LegacyExecutionEngine();

    return new CombinedOrchestrationEngine(planning, execution);
};
// trigger reload
