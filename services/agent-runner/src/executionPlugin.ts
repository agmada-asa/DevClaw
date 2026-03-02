import axios from 'axios';
import { ArchitecturePlan } from '@devclaw/contracts';

export interface ExecutePayload {
    runId: string;
    planId?: string;
    requestId?: string;
    userId?: string;
    repo?: string;
    issueNumber?: number;
    issueUrl?: string;
    description?: string;
    plan?: ArchitecturePlan;
}

export interface ExecuteDispatch {
    runRef: string;
    engine: 'stub' | 'openclaw';
    accepted: boolean;
}

interface ExecutionPlugin {
    execute(payload: ExecutePayload): Promise<ExecuteDispatch>;
}

class StubExecutionPlugin implements ExecutionPlugin {
    async execute(payload: ExecutePayload): Promise<ExecuteDispatch> {
        return {
            runRef: `stub-${payload.runId}`,
            engine: 'stub',
            accepted: true,
        };
    }
}

class OpenClawExecutionPlugin implements ExecutionPlugin {
    private readonly baseUrl = process.env.OPENCLAW_RUNNER_URL || 'http://localhost:3040';
    private readonly executePath = process.env.OPENCLAW_RUNNER_EXECUTE_PATH || '/api/execute';

    async execute(payload: ExecutePayload): Promise<ExecuteDispatch> {
        const res = await axios.post(`${this.baseUrl}${this.executePath}`, {
            ...payload,
            source: 'agent-runner',
            callbackUrl: process.env.ORCHESTRATOR_CALLBACK_URL,
        });

        return {
            runRef: res.data?.runRef || payload.runId,
            engine: 'openclaw',
            accepted: true,
        };
    }
}

export const getExecutionPlugin = (): ExecutionPlugin => {
    const engine = (process.env.RUNNER_ENGINE || 'stub').toLowerCase();
    if (engine === 'openclaw') {
        return new OpenClawExecutionPlugin();
    }
    return new StubExecutionPlugin();
};
