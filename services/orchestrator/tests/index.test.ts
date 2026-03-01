import request from 'supertest';
import axios from 'axios';
import app from '../src/index';
import { createOrDedupeIssue } from '../src/githubClient';

// Mock axios and githubClient so we don't make real HTTP calls
jest.mock('axios');
jest.mock('../src/githubClient');

const mockedAxiosPost = axios.post as jest.MockedFunction<typeof axios.post>;
const mockedCreateOrDedupe = createOrDedupeIssue as jest.MockedFunction<typeof createOrDedupeIssue>;

describe('Orchestrator API', () => {
    beforeEach(() => {
        // Ensure axios.post always returns a resolved promise by default
        // (prevents fire-and-forget approval card calls from crashing tests)
        mockedAxiosPost.mockResolvedValue({ data: {} });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ── Health Check ─────────────────────────────────────────────────────────

    it('GET /health → 200 ok', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'ok', service: 'orchestrator' });
    });

    // ── POST /api/task — Validation ───────────────────────────────────────────

    it('POST /api/task → 400 when required fields are missing', async () => {
        const res = await request(app)
            .post('/api/task')
            .send({ userId: 'u1', channel: 'telegram' }); // missing repo, githubToken, description
        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error');
    });

    it('POST /api/task → 400 when repo format is invalid', async () => {
        const res = await request(app).post('/api/task').send({
            userId: 'u1',
            channel: 'telegram',
            chatId: '123',
            repo: 'not-owner-slash-repo-format',
            githubToken: 'ghtoken',
            description: 'Fix the login button',
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Invalid repo format/);
    });

    // ── POST /api/task — Issue Creation ───────────────────────────────────────

    it('POST /api/task → creates new GitHub issue and returns ACK', async () => {
        mockedCreateOrDedupe.mockResolvedValueOnce({
            number: 42,
            html_url: 'https://github.com/owner/repo/issues/42',
            isDuplicate: false,
        });
        // Supabase not configured in test env, so DB persistence will be skipped (warning only)

        const res = await request(app).post('/api/task').send({
            userId: 'u1',
            channel: 'telegram',
            chatId: '123',
            repo: 'owner/repo',
            githubToken: 'ghtoken',
            description: 'Fix the login button on mobile Safari',
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.issueNumber).toBe(42);
        expect(res.body.issueUrl).toBe('https://github.com/owner/repo/issues/42');
        expect(res.body.message).toContain('opened a GitHub issue');
        expect(mockedCreateOrDedupe).toHaveBeenCalledWith(
            'ghtoken',
            'owner',
            'repo',
            expect.stringContaining('Fix the login button'),
            expect.any(String)
        );
    });

    it('POST /api/task → links to duplicate issue and returns ACK', async () => {
        mockedCreateOrDedupe.mockResolvedValueOnce({
            number: 7,
            html_url: 'https://github.com/owner/repo/issues/7',
            isDuplicate: true,
        });

        const res = await request(app).post('/api/task').send({
            userId: 'u1',
            channel: 'telegram',
            chatId: '123',
            repo: 'owner/repo',
            githubToken: 'ghtoken',
            description: 'Fix the login button on mobile Safari',
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.issueNumber).toBe(7);
        expect(res.body.message).toContain('existing issue');
        expect(mockedCreateOrDedupe).toHaveBeenCalledTimes(1);
    });

    it('POST /api/task → 502 when GitHub API fails', async () => {
        mockedCreateOrDedupe.mockRejectedValueOnce(
            Object.assign(new Error('GitHub API error'), {
                response: { data: { message: 'Bad credentials' } },
            })
        );

        const res = await request(app).post('/api/task').send({
            userId: 'u1',
            channel: 'telegram',
            chatId: '123',
            repo: 'owner/repo',
            githubToken: 'bad-token',
            description: 'Fix the login button',
        });

        expect(res.status).toBe(502);
        expect(res.body.error).toMatch(/GitHub issue/);
    });
});
