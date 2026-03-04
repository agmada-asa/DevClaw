import { AgentLoopManager, AgentLoopReport } from './agentLoopManager';
import {
    ExecuteDispatch,
    ExecutePayload,
    ExecutionPlugin,
} from './executionPlugin';

const isAgentLoopEnabled = (): boolean => {
    const value = process.env.RUNNER_AGENT_LOOP_ENABLED;
    if (typeof value !== 'string') {
        return true;
    }
    return value.trim().toLowerCase() !== 'false';
};

export interface CoordinatedExecuteResult extends ExecuteDispatch {
    agentLoopReport?: AgentLoopReport;
}

export class ExecutionCoordinator {
    constructor(
        private readonly executionPlugin: ExecutionPlugin,
        private readonly loopManager: AgentLoopManager = new AgentLoopManager()
    ) { }

    async execute(payload: ExecutePayload): Promise<CoordinatedExecuteResult> {
        const agentLoopReport =
            isAgentLoopEnabled() && payload.executionSubTasks?.length
                ? await this.loopManager.run(payload)
                : null;

        const dispatchPayload = agentLoopReport
            ? {
                ...payload,
                agentLoopReport,
            }
            : payload;
        const dispatch = await this.executionPlugin.execute(dispatchPayload);

        return {
            ...dispatch,
            ...(agentLoopReport ? { agentLoopReport } : {}),
        };
    }
}

