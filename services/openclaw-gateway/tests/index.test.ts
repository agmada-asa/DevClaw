import request from 'supertest';
import app from '../src/index';

describe('OpenClaw Gateway API', () => {
    it('should return 200 OK for the health check', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ok' });
    });

    describe('POST /api/ingress/message', () => {
        it('should return 400 if provider is missing', async () => {
            const res = await request(app)
                .post('/api/ingress/message')
                .send({ payload: { text: 'hello' } });

            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error');
        });

        it('should return 400 if payload is missing', async () => {
            const res = await request(app)
                .post('/api/ingress/message')
                .send({ provider: 'telegram' });

            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error');
        });

        it('should ingest valid messages and return 200', async () => {
            const payload = {
                provider: 'telegram',
                payload: {
                    chatId: 123,
                    text: 'hello devclaw'
                }
            };

            const res = await request(app)
                .post('/api/ingress/message')
                .send(payload);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, message: 'Message ingested' });
        });
    });
});
