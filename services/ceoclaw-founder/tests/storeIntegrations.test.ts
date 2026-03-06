import { OutreachCampaign, ProspectRecord } from '@devclaw/contracts';

const mockCreateClient = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
    createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

const makeCampaign = (): OutreachCampaign => ({
    campaignId: 'camp-1',
    name: 'Campaign One',
    searchQuery: 'CTO startup',
    targetIndustries: ['software'],
    targetCompanySizes: ['11-50'],
    targetTitles: ['CTO'],
    maxProspects: 20,
    minFitScore: 65,
    status: 'draft',
    prospectsFound: 3,
    prospectsQualified: 2,
    messagesGenerated: 2,
    messagesSent: 1,
    replies: 0,
    createdAt: '2026-03-06T10:00:00.000Z',
    updatedAt: '2026-03-06T10:00:00.000Z',
});

const makeProspect = (): ProspectRecord => ({
    prospectId: 'prospect-1',
    campaignId: 'camp-1',
    linkedinProfileUrl: 'https://linkedin.com/in/founder',
    linkedinCompanyUrl: 'https://linkedin.com/company/devclaw',
    firstName: 'Ada',
    lastName: 'Lovelace',
    title: 'CTO',
    companyName: 'DevClaw',
    companySize: '11-50',
    industry: 'Software',
    location: 'London',
    fitScore: 90,
    fitReason: 'Strong buyer fit',
    outreachMessage: 'Hi Ada!',
    status: 'qualified',
    connectionSentAt: undefined,
    messagedAt: undefined,
    repliedAt: undefined,
    createdAt: '2026-03-06T10:00:00.000Z',
    updatedAt: '2026-03-06T10:00:00.000Z',
});

describe('store integrations', () => {
    const envBackup = { ...process.env };

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env = { ...envBackup };
        process.env.SUPABASE_URL = 'https://example.supabase.co';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    });

    afterAll(() => {
        process.env = envBackup;
    });

    it('persists campaign counters using runtime schema field names', async () => {
        const upsertMock = jest.fn().mockResolvedValue({ error: null });
        const fromMock = jest.fn().mockReturnValue({ upsert: upsertMock });
        mockCreateClient.mockReturnValue({ from: fromMock });

        const store = await import('../src/prospectStore');
        await store.saveCampaign(makeCampaign());

        const payload = upsertMock.mock.calls[0][0];
        expect(payload.status).toBe('draft');
        expect(payload.prospects_found).toBe(3);
        expect(payload.prospects_discovered).toBeUndefined();
        expect(payload.search_query).toBe('CTO startup');
    });

    it('persists linkedin_profile_url for prospects', async () => {
        const upsertMock = jest.fn().mockResolvedValue({ error: null });
        const fromMock = jest.fn().mockReturnValue({ upsert: upsertMock });
        mockCreateClient.mockReturnValue({ from: fromMock });

        const store = await import('../src/prospectStore');
        await store.saveProspect(makeProspect());

        const payload = upsertMock.mock.calls[0][0];
        expect(payload.linkedin_profile_url).toBe('https://linkedin.com/in/founder');
        expect(payload.linkedin_url).toBeUndefined();
        expect(payload.outreach_message).toBe('Hi Ada!');
    });

    it('patches founder business state through Supabase snake_case columns', async () => {
        const row = {
            id: 'singleton',
            mrr: 10,
            total_signups: 5,
            active_users: 2,
            traffic_last_30d: 100,
            landing_page_url: null,
            latest_idea: null,
            latest_content_title: null,
            tasks_completed_today: 1,
            tasks_completed_total: 3,
            loop_enabled: false,
            phase: 'pre-launch',
            updated_at: '2026-03-06T10:00:00.000Z',
        };

        const singleMock = jest.fn().mockResolvedValue({ data: row, error: null });
        const eqMock = jest.fn().mockReturnValue({ single: singleMock });
        const selectMock = jest.fn().mockReturnValue({ eq: eqMock });
        const upsertMock = jest.fn().mockResolvedValue({ error: null });

        const fromMock = jest.fn((table: string) => {
            if (table === 'ceoclaw_business_state') {
                return { select: selectMock, upsert: upsertMock };
            }
            throw new Error(`Unexpected table: ${table}`);
        });

        mockCreateClient.mockReturnValue({ from: fromMock });

        const store = await import('../src/founderStore');
        const updated = await store.patchBusinessState({ mrr: 42, totalSignups: 9 });

        expect(updated.mrr).toBe(42);
        expect(updated.totalSignups).toBe(9);
        expect(upsertMock).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'singleton',
                mrr: 42,
                total_signups: 9,
                active_users: 2,
                traffic_last_30d: 100,
            }),
            { onConflict: 'id' }
        );
    });
});
