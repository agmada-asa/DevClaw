import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { generateArchitecturePlan } from '@devclaw/llm-router';

dotenv.config();

const app = express();
const port = process.env.PORT || 3020;

app.use(cors());
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'architecture-planner' });
});

app.post('/api/plan', async (req: Request, res: Response): Promise<any> => {
    const { requestId, userId, repo, description, issueNumber } = req.body || {};

    if (!requestId || !userId || !repo || !description) {
        return res.status(400).json({
            error: 'Missing required fields: requestId, userId, repo, description',
        });
    }

    try {
        const plan = await generateArchitecturePlan({
            requestId: String(requestId),
            userId: String(userId),
            repo: String(repo),
            description: String(description),
            issueNumber: typeof issueNumber === 'number' ? issueNumber : undefined,
        });
        return res.status(200).json(plan);
    } catch (err: any) {
        console.error('[ArchitecturePlanner] Failed to generate plan:', err.response?.data || err.message);
        return res.status(502).json({
            error: 'Failed to generate architecture plan',
        });
    }
});

if (require.main === module) {
    app.listen(port, () => {
        console.log(`[ArchitecturePlanner] Service listening on port ${port}`);
    });
}

export default app;
