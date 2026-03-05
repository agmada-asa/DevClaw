import { AgentLoopReport } from './agentLoopManager';
import {
    ApprovedPatchSet,
    BranchPushResult,
    ExecuteDispatch,
    ExecutePayload,
    ExecutionPlugin,
} from './executionPlugin';

export interface CoordinatedExecuteResult extends ExecuteDispatch {
    agentLoopReport?: AgentLoopReport;
    approvedPatchSet?: ApprovedPatchSet;
    branchPush?: BranchPushResult;
}

export class ExecutionCoordinator {
    constructor(private readonly executionPlugin: ExecutionPlugin) { }

    async execute(payload: ExecutePayload): Promise<CoordinatedExecuteResult> {
        const dispatch = await this.executionPlugin.execute(payload);

        return {
            ...dispatch,
            ...(dispatch.approvedPatchSet
                ? { approvedPatchSet: dispatch.approvedPatchSet }
                : {}),
            ...(dispatch.branchPush
                ? { branchPush: dispatch.branchPush }
                : {}),
        };
    }
}
