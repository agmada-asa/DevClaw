import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { getExecutionPlugin } from './executionPlugin';

dotenv.config();

const app = express();
const port = process.env.PORT || 3030;
const executionPlugin = getExecutionPlugin();

app.use(cors());
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'agent-runner' });
});

app.post('/api/execute', async (req: Request, res: Response): Promise<any> => {
    const payload = req.body || {};
    const { runId } = payload;

    if (!runId) {
        return res.status(400).json({ error: 'Missing required field: runId' });
    }

    try {
        const dispatch = await executionPlugin.execute(payload);
        return res.status(202).json({
            success: true,
            status: 'dispatched',
            runRef: dispatch.runRef,
            engine: dispatch.engine,
        });
    } catch (err: any) {
        console.error('[AgentRunner] Failed to dispatch execution:', err.response?.data || err.message);
        return res.status(502).json({ error: 'Failed to dispatch execution run' });
    }
});

if (require.main === module) {
    app.listen(port, () => {
        console.log(`[AgentRunner] Service listening on port ${port}`);
    });
}

export default app;
