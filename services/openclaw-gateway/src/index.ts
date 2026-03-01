import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// Main ingestion endpoint for all bot messages
app.post('/api/ingress/message', async (req: Request, res: Response): Promise<any> => {
    const { provider, payload } = req.body;

    if (!provider || !payload) {
        return res.status(400).json({ error: 'Missing provider or payload' });
    }

    console.log(`[Gateway] Received message from ${provider}:`, JSON.stringify(payload, null, 2));

    const text = payload.text || '';
    const userId = payload.userId ? payload.userId.toString() : '';

    if (payload.type === 'repo_link') {
        const parts = text.split(' ');
        if (parts.length < 2) {
            return res.status(400).json({ error: 'Invalid repo format. Use /repo <owner>/<repo>' });
        }
        const repo = parts[1].trim();

        if (supabase) {
            const { error } = await supabase
                .from('user_preferences')
                .upsert({ user_id: userId, github_repo: repo }, { onConflict: 'user_id' });

            if (error) {
                console.error('[Gateway] Error saving to Supabase:', error);
                return res.status(500).json({ error: 'Failed to save repository link' });
            }
        } else {
            console.warn('[Gateway] Supabase not configured. Ignoring repo link.');
            return res.status(500).json({ error: 'Database not configured on server' });
        }

        return res.status(200).json({ success: true, message: `Successfully linked repository: ${repo}` });
    }

    if (payload.type === 'task') {
        let repo = '';
        if (supabase) {
            const { data, error } = await supabase
                .from('user_preferences')
                .select('github_repo')
                .eq('user_id', userId)
                .single();

            if (error || !data) {
                return res.status(200).json({ success: false, message: 'No GitHub repository linked. Please use /repo <owner>/<repo> first.' });
            }
            repo = data.github_repo;
        }

        if (repo) {
            const githubToken = process.env.GITHUB_TOKEN;
            if (githubToken) {
                try {
                    const issueDescription = text.replace(/^\/task /i, '').replace(/^\/request /i, '').trim();
                    const response = await axios.post(`https://api.github.com/repos/${repo}/issues`, {
                        title: `Task from ${provider}`,
                        body: `This issue was created from ${provider} by user ${payload.username || payload.userId}.\n\n**Task:**\n${issueDescription}`
                    }, {
                        headers: {
                            'Authorization': `Bearer ${githubToken}`,
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    });

                    console.log(`[Gateway] Created GitHub issue: ${response.data.html_url}`);
                    return res.status(200).json({ success: true, message: `GitHub Issue created: ${response.data.html_url}` });
                } catch (error: any) {
                    console.error('[Gateway] Error creating GitHub issue:', error.response?.data || error.message);
                    return res.status(500).json({ error: 'Failed to create GitHub issue' });
                }
            } else {
                console.warn('[Gateway] GITHUB_TOKEN not configured. Cannot create issue.');
                return res.status(500).json({ error: 'GitHub token not configured on server' });
            }
        } else {
            return res.status(200).json({ success: false, message: 'Supabase is not configured to check for repo' });
        }
    }

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
