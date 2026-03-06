import { OutreachCampaign, ProspectRecord } from '@devclaw/contracts';

jest.mock('uuid', () => ({
    v4: jest.fn(() => 'uuid-fixed'),
}));

jest.mock('../src/linkedinProspector', () => ({
    discoverProspects: jest.fn(),
}));

jest.mock('../src/outreachCliAgent', () => ({
    qualifyProspect: jest.fn(),
    generateOutreachMessage: jest.fn(),
}));

jest.mock('../src/linkedinMessenger', () => ({
    sendOutreachBatch: jest.fn(),
}));

jest.mock('../src/prospectStore', () => ({
    saveCampaign: jest.fn(),
    getCampaign: jest.fn(),
    saveProspect: jest.fn(),
    updateProspectStatus: jest.fn(),
    updateCampaignStatus: jest.fn(),
    getProspectsByCampaign: jest.fn(),
    isAlreadyProspected: jest.fn(),
}));

import {
    createCampaign,
    discoverAndQualify,
    resumeCampaignSending,
} from '../src/campaignManager';
import { discoverProspects } from '../src/linkedinProspector';
import { qualifyProspect, generateOutreachMessage } from '../src/outreachCliAgent';
import { sendOutreachBatch } from '../src/linkedinMessenger';
import {
    saveCampaign,
    getCampaign,
    saveProspect,
    updateProspectStatus,
    updateCampaignStatus,
    getProspectsByCampaign,
    isAlreadyProspected,
} from '../src/prospectStore';

const mockDiscoverProspects = discoverProspects as jest.MockedFunction<typeof discoverProspects>;
const mockQualifyProspect = qualifyProspect as jest.MockedFunction<typeof qualifyProspect>;
const mockGenerateOutreachMessage = generateOutreachMessage as jest.MockedFunction<typeof generateOutreachMessage>;
const mockSendOutreachBatch = sendOutreachBatch as jest.MockedFunction<typeof sendOutreachBatch>;

const mockSaveCampaign = saveCampaign as jest.MockedFunction<typeof saveCampaign>;
const mockGetCampaign = getCampaign as jest.MockedFunction<typeof getCampaign>;
const mockSaveProspect = saveProspect as jest.MockedFunction<typeof saveProspect>;
const mockUpdateProspectStatus = updateProspectStatus as jest.MockedFunction<typeof updateProspectStatus>;
const mockUpdateCampaignStatus = updateCampaignStatus as jest.MockedFunction<typeof updateCampaignStatus>;
const mockGetProspectsByCampaign = getProspectsByCampaign as jest.MockedFunction<typeof getProspectsByCampaign>;
const mockIsAlreadyProspected = isAlreadyProspected as jest.MockedFunction<typeof isAlreadyProspected>;

const makeCampaign = (overrides: Partial<OutreachCampaign> = {}): OutreachCampaign => ({
    campaignId: 'camp-1',
    name: 'Campaign One',
    searchQuery: 'CTO startup',
    targetIndustries: [],
    targetCompanySizes: [],
    targetTitles: [],
    maxProspects: 10,
    minFitScore: 65,
    status: 'draft',
    prospectsFound: 0,
    prospectsQualified: 0,
    messagesGenerated: 0,
    messagesSent: 0,
    replies: 0,
    createdAt: '2026-03-06T10:00:00.000Z',
    updatedAt: '2026-03-06T10:00:00.000Z',
    ...overrides,
});

const makeProspect = (overrides: Partial<ProspectRecord> = {}): ProspectRecord => ({
    prospectId: 'p-1',
    campaignId: 'camp-1',
    linkedinProfileUrl: 'https://linkedin.com/in/p1',
    linkedinCompanyUrl: undefined,
    firstName: 'Ada',
    lastName: 'Lovelace',
    title: 'CTO',
    companyName: 'Analytical Engines Ltd',
    companySize: '11-50',
    industry: 'Software',
    location: 'London',
    fitScore: undefined,
    fitReason: undefined,
    outreachMessage: undefined,
    status: 'discovered',
    connectionSentAt: undefined,
    messagedAt: undefined,
    repliedAt: undefined,
    createdAt: '2026-03-06T10:00:00.000Z',
    updatedAt: '2026-03-06T10:00:00.000Z',
    ...overrides,
});

beforeEach(() => {
    jest.clearAllMocks();
});

describe('createCampaign', () => {
    it('creates campaigns with draft status and persists them', async () => {
        const campaign = await createCampaign({
            name: 'April CTO Outreach',
            searchQuery: 'CTO startup',
        });

        expect(campaign.status).toBe('draft');
        expect(campaign.prospectsFound).toBe(0);
        expect(campaign.messagesSent).toBe(0);
        expect(mockSaveCampaign).toHaveBeenCalledWith(
            expect.objectContaining({
                campaignId: 'uuid-fixed',
                name: 'April CTO Outreach',
                status: 'draft',
            })
        );
    });
});

describe('discoverAndQualify', () => {
    it('runs discovery -> qualification -> message generation and pauses campaign', async () => {
        mockGetCampaign.mockResolvedValue(makeCampaign());
        mockDiscoverProspects.mockResolvedValue([
            {
                firstName: 'Ada',
                lastName: 'Lovelace',
                title: 'CTO',
                companyName: 'Analytical Engines Ltd',
                linkedinProfileUrl: 'https://linkedin.com/in/ada',
                linkedinCompanyUrl: 'https://linkedin.com/company/analytical',
                industry: 'Software',
                companySize: '11-50',
                location: 'London',
                connectionDegree: '2nd',
            },
            {
                firstName: 'Grace',
                lastName: 'Hopper',
                title: 'Engineering Manager',
                companyName: 'Compiler Labs',
                linkedinProfileUrl: 'https://linkedin.com/in/grace',
                linkedinCompanyUrl: 'https://linkedin.com/company/compiler',
                industry: 'Software',
                companySize: '51-200',
                location: 'New York',
                connectionDegree: '2nd',
            },
        ]);
        mockIsAlreadyProspected.mockResolvedValue(false);
        mockQualifyProspect
            .mockResolvedValueOnce({
                qualified: true,
                fitScore: 88,
                fitReason: 'Strong technical decision-maker',
                decisionReason: 'Has direct influence on engineering velocity tooling.',
            })
            .mockResolvedValueOnce({
                qualified: false,
                fitScore: 45,
                fitReason: 'Low ICP fit',
                decisionReason: 'Not an ideal buying persona.',
            });
        mockGenerateOutreachMessage.mockResolvedValue({
            message: 'Hi Ada — can I show you how DevClaw reduces PR cycle time?',
            subject: 'Dev velocity for startup CTOs',
        });

        const result = await discoverAndQualify('camp-1');

        expect(result).toEqual(
            expect.objectContaining({
                campaignId: 'camp-1',
                prospectsDiscovered: 2,
                prospectsQualified: 1,
                messagesGenerated: 1,
                messagesSent: 0,
            })
        );
        expect(mockSaveProspect).toHaveBeenCalledTimes(2);
        expect(mockUpdateProspectStatus).toHaveBeenCalledWith(
            expect.any(String),
            'qualified',
            expect.objectContaining({ fitScore: 88 })
        );
        expect(mockUpdateProspectStatus).toHaveBeenCalledWith(
            expect.any(String),
            'disqualified',
            expect.objectContaining({ fitScore: 45 })
        );
        expect(mockUpdateProspectStatus).toHaveBeenCalledWith(
            expect.any(String),
            'message_ready',
            expect.objectContaining({ outreachMessage: expect.stringContaining('DevClaw') })
        );
        expect(mockUpdateCampaignStatus).toHaveBeenCalledWith('camp-1', 'paused');
    });
});

describe('resumeCampaignSending', () => {
    it('sends only message_ready prospects and marks campaign completed', async () => {
        mockGetCampaign.mockResolvedValue(makeCampaign({ status: 'paused' }));
        mockGetProspectsByCampaign.mockResolvedValue([
            makeProspect({
                prospectId: 'p-1',
                status: 'message_ready',
                outreachMessage: 'Hello from DevClaw',
            }),
            makeProspect({
                prospectId: 'p-2',
                status: 'disqualified',
                outreachMessage: undefined,
            }),
        ]);
        mockSendOutreachBatch.mockResolvedValue([
            {
                prospectId: 'p-1',
                profileUrl: 'https://linkedin.com/in/p1',
                sent: true,
                method: 'direct_message',
            },
        ]);

        const result = await resumeCampaignSending('camp-1');

        expect(result.messagesSent).toBe(1);
        expect(mockSendOutreachBatch).toHaveBeenCalledWith([
            expect.objectContaining({ prospectId: 'p-1' }),
        ], {});
        expect(mockUpdateProspectStatus).toHaveBeenCalledWith(
            'p-1',
            'messaged',
            expect.objectContaining({ messagedAt: expect.any(String) })
        );
        expect(mockUpdateCampaignStatus).toHaveBeenCalledWith(
            'camp-1',
            'running',
            expect.objectContaining({ messagesSent: 1 })
        );
        expect(mockUpdateCampaignStatus).toHaveBeenCalledWith('camp-1', 'completed');
    });
});
