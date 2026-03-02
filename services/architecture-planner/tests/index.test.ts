import request from 'supertest';
import app from '../src/index';

describe('Architecture Planner API', () => {
    it('GET /health -> 200 ok', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ok', service: 'architecture-planner' });
    });

    it('POST /api/plan -> 400 when required fields are missing', async () => {
        const res = await request(app).post('/api/plan').send({ requestId: 'r1' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Missing required fields/);
    });

    it('POST /api/plan -> 200 with typed plan payload', async () => {
        const res = await request(app).post('/api/plan').send({
            requestId: 'req-12345678',
            userId: 'u1',
            repo: 'owner/repo',
            description: 'Fix mobile login button behavior in Safari and improve auth checks',
            issueNumber: 42,
        });

        expect(res.status).toBe(200);
        expect(res.body.planId).toBe('plan-req-1234');
        expect(res.body.requestId).toBe('req-12345678');
        expect(typeof res.body.summary).toBe('string');
        expect(Array.isArray(res.body.affectedFiles)).toBe(true);
        expect(Array.isArray(res.body.agentAssignments)).toBe(true);
        expect(res.body.status).toBe('pending_approval');
    });
});
