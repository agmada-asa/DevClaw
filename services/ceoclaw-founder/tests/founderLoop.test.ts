import { BusinessState } from '../src/founderTypes';

jest.mock('../src/taskRouter', () => ({
    routeNextTask: jest.fn(),
}));

jest.mock('../src/productDomain', () => ({
    generateIdea: jest.fn(),
    buildLandingPage: jest.fn(),
}));

jest.mock('../src/marketingDomain', () => ({
    writeSeoContent: jest.fn(),
    planCampaign: jest.fn(),
}));

jest.mock('../src/operationsDomain', () => ({
    analyzeMetrics: jest.fn(),
    processFeedback: jest.fn(),
    planIteration: jest.fn(),
}));

jest.mock('../src/campaignManager', () => ({
    createCampaign: jest.fn(),
    discoverAndQualify: jest.fn(),
    resumeCampaignSending: jest.fn(),
}));

jest.mock('../src/prospectStore', () => ({
    getProspectsByCampaign: jest.fn(),
    getProspectsByStatus: jest.fn(),
    listCampaigns: jest.fn(),
    updateProspectStatus: jest.fn(),
}));

jest.mock('../src/linkedinMessenger', () => ({
    getPendingConnectionUrls: jest.fn(),
    sendOutreachBatch: jest.fn(),
}));

jest.mock('../src/founderStore', () => ({
    loadBusinessState: jest.fn(),
    patchBusinessState: jest.fn(),
    setLoopEnabled: jest.fn(),
    appendTaskLog: jest.fn(),
    updateTaskLog: jest.fn(),
    getRecentCompletedTaskTypes: jest.fn(),
}));

jest.mock('uuid', () => ({
    v4: jest.fn(() => 'task-uuid-1'),
}));

import { runOneIteration, runTaskByType } from '../src/founderLoop';
import { routeNextTask } from '../src/taskRouter';
import { analyzeMetrics, processFeedback } from '../src/operationsDomain';
import { writeSeoContent } from '../src/marketingDomain';
import {
    loadBusinessState,
    patchBusinessState,
    appendTaskLog,
    updateTaskLog,
    getRecentCompletedTaskTypes,
} from '../src/founderStore';

const mockRouteNextTask = routeNextTask as jest.MockedFunction<typeof routeNextTask>;
const mockAnalyzeMetrics = analyzeMetrics as jest.MockedFunction<typeof analyzeMetrics>;
const mockProcessFeedback = processFeedback as jest.MockedFunction<typeof processFeedback>;
const mockWriteSeoContent = writeSeoContent as jest.MockedFunction<typeof writeSeoContent>;
const mockLoadBusinessState = loadBusinessState as jest.MockedFunction<typeof loadBusinessState>;
const mockPatchBusinessState = patchBusinessState as jest.MockedFunction<typeof patchBusinessState>;
const mockAppendTaskLog = appendTaskLog as jest.MockedFunction<typeof appendTaskLog>;
const mockUpdateTaskLog = updateTaskLog as jest.MockedFunction<typeof updateTaskLog>;
const mockGetRecentCompletedTaskTypes = getRecentCompletedTaskTypes as jest.MockedFunction<typeof getRecentCompletedTaskTypes>;

const makeState = (overrides: Partial<BusinessState> = {}): BusinessState => ({
    mrr: 0,
    totalSignups: 0,
    activeUsers: 0,
    trafficLast30d: 0,
    landingPageUrl: undefined,
    latestIdea: undefined,
    latestContentTitle: undefined,
    tasksCompletedToday: 0,
    tasksCompletedTotal: 0,
    loopEnabled: false,
    phase: 'pre-launch',
    updatedAt: '2026-03-06T10:00:00.000Z',
    ...overrides,
});

beforeEach(() => {
    jest.clearAllMocks();
    mockLoadBusinessState.mockResolvedValue(makeState());
    mockGetRecentCompletedTaskTypes.mockResolvedValue([]);
    mockPatchBusinessState.mockResolvedValue(makeState());
});

describe('runOneIteration', () => {
    it('routes, executes, logs, and updates state on success', async () => {
        mockRouteNextTask.mockResolvedValue({
            taskType: 'operations.analyze_metrics',
            domain: 'operations',
            reason: 'Check bottlenecks',
            priority: 'high',
        });
        mockAnalyzeMetrics.mockResolvedValue({
            summary: 'Traffic bottleneck',
            keyInsights: ['Very low top-of-funnel'],
            bottleneck: 'traffic',
            recommendedActions: ['Publish SEO content'],
            mrrForecast: '$15',
        });

        const record = await runOneIteration();

        expect(record.status).toBe('completed');
        expect(record.taskType).toBe('operations.analyze_metrics');
        expect(mockAppendTaskLog).toHaveBeenCalledWith(
            expect.objectContaining({
                taskId: 'task-uuid-1',
                taskType: 'operations.analyze_metrics',
                status: 'running',
                reason: 'Check bottlenecks',
            })
        );
        expect(mockUpdateTaskLog).toHaveBeenCalledWith(
            'task-uuid-1',
            expect.objectContaining({ status: 'completed' })
        );
        expect(mockPatchBusinessState).toHaveBeenCalledWith(
            expect.objectContaining({
                tasksCompletedToday: 1,
                tasksCompletedTotal: 1,
            })
        );
    });

    it('marks task as failed and increments tasksCompletedToday on error', async () => {
        mockRouteNextTask.mockResolvedValue({
            taskType: 'operations.process_feedback',
            domain: 'operations',
            reason: 'Handle incoming churn feedback',
            priority: 'high',
        });
        mockProcessFeedback.mockRejectedValue(new Error('feedback provider timeout'));

        const record = await runOneIteration();

        expect(record.status).toBe('failed');
        expect(record.error).toContain('feedback provider timeout');
        expect(mockUpdateTaskLog).toHaveBeenCalledWith(
            'task-uuid-1',
            expect.objectContaining({
                status: 'failed',
                error: 'feedback provider timeout',
            })
        );
        expect(mockPatchBusinessState).toHaveBeenCalledWith({ tasksCompletedToday: 1 });
    });
});

describe('runTaskByType', () => {
    it('executes explicit task type without router and applies state overrides deterministically', async () => {
        mockWriteSeoContent.mockResolvedValue({
            title: 'How CTOs Ship Faster with AI',
            slug: 'how-ctos-ship-faster-with-ai',
            metaDescription: 'Practical playbook for AI-assisted delivery.',
            markdown: '# Post',
            targetKeywords: ['ai coding assistant'],
        });

        const record = await runTaskByType('marketing.write_seo_content', {
            reason: 'Manual SEO validation',
            priority: 'low',
            stateOverrides: {
                tasksCompletedToday: 5,
                tasksCompletedTotal: 9,
            },
        });

        expect(record.status).toBe('completed');
        expect(record.taskType).toBe('marketing.write_seo_content');
        expect(mockRouteNextTask).not.toHaveBeenCalled();
        expect(mockWriteSeoContent).toHaveBeenCalledWith(
            expect.objectContaining({
                tasksCompletedToday: 5,
                tasksCompletedTotal: 9,
            })
        );
        expect(mockPatchBusinessState).toHaveBeenCalledWith(
            expect.objectContaining({
                tasksCompletedToday: 6,
                tasksCompletedTotal: 10,
                latestContentTitle: 'How CTOs Ship Faster with AI',
            })
        );
    });
});
