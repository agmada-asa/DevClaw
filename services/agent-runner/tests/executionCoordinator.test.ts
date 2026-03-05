import { ExecutionCoordinator } from '../src/executionCoordinator';
import {
    ApprovedPatchSet,
    BranchPushResult,
    ExecutePayload,
    ExecutionPlugin,
} from '../src/executionPlugin';

const createPayload = (overrides?: Partial<ExecutePayload>): ExecutePayload => ({
    runId: 'run-123',
    planId: 'plan-123',
    executionSubTasks: [
        {
            id: 'plan-123-frontend',
            domain: 'frontend',
            agent: 'Frontend',
            objective: 'Fix frontend behavior',
            files: ['apps/web/src/App.tsx'],
            generator: 'FrontendGenerator',
            reviewer: 'FrontendReviewer',
        },
    ],
    ...overrides,
});

const createPatchSet = (): ApprovedPatchSet => ({
    patchSetRef: 'run-123:abc123',
    runId: 'run-123',
    planId: 'plan-123',
    branchName: 'devclaw/fix-plan-123',
    baseCommit: 'abc',
    headCommit: 'def',
    createdAt: new Date().toISOString(),
    subTasks: [],
    patch: 'diff --git a/file b/file',
});

const createBranchPush = (): BranchPushResult => ({
    remote: 'origin',
    branchName: 'devclaw/fix-plan-123',
    headCommit: 'def',
    pushed: true,
});

describe('ExecutionCoordinator', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('dispatches to plugin and forwards approved patch metadata', async () => {
        const plugin: ExecutionPlugin = {
            execute: jest.fn(async () => ({
                runRef: 'openclaw-run-123',
                engine: 'openclaw' as const,
                accepted: true,
                approvedPatchSet: createPatchSet(),
                branchPush: createBranchPush(),
            })),
        };

        const coordinator = new ExecutionCoordinator(plugin);
        const result = await coordinator.execute(createPayload({
            isolatedEnvironmentPath: '/tmp/workspace',
            executionBranchName: 'devclaw/fix-plan-123',
        }));

        expect(plugin.execute).toHaveBeenCalledTimes(1);

        expect(result).toMatchObject({
            runRef: 'openclaw-run-123',
            engine: 'openclaw',
            accepted: true,
        });
        expect(result.approvedPatchSet?.patchSetRef).toBe('run-123:abc123');
        expect(result.branchPush?.pushed).toBe(true);
    });

    it('dispatches payload without loop metadata', async () => {
        const plugin: ExecutionPlugin = {
            execute: jest.fn(async () => ({
                runRef: 'stub-run-123',
                engine: 'stub' as const,
                accepted: true,
            })),
        };
        const coordinator = new ExecutionCoordinator(plugin);
        const result = await coordinator.execute(createPayload({
            isolatedEnvironmentPath: undefined,
            executionBranchName: undefined,
        }));

        expect(plugin.execute).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            runRef: 'stub-run-123',
            engine: 'stub',
            accepted: true,
        });
    });
});
