import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Main ingestion endpoint for all bot messages
app.post('/api/ingress/message', (req: Request, res: Response) => {
    const { provider, payload } = req.body;

    if (!provider || !payload) {
        return res.status(400).json({ error: 'Missing provider or payload' });
    }

    console.log(`[Gateway] Received message from ${provider}:`, JSON.stringify(payload, null, 2));

    // In a real implementation this would forward to the orchestrator layer
    // For now, we just acknowledge receipt

    res.status(200).json({ success: true, message: 'Message ingested' });
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
});

// Only start the server if not imported as a module (useful for testing)
if (require.main === module) {
    app.listen(port, () => {
        console.log(`[Gateway] Service listening on port ${port}`);
    });
}

export default app;
