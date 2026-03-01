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

// OAuth Init Endpoint
app.get('/api/auth/github', (req: Request, res: Response): any => {
    const userId = req.query.userId as string;
    const provider = req.query.provider as string;

    if (!userId || !provider) {
        return res.status(400).json({ error: 'Missing userId or provider' });
    }

    const state = Buffer.from(JSON.stringify({ userId, provider })).toString('base64');
    const clientId = process.env.GITHUB_CLIENT_ID;

    if (!clientId) {
        return res.status(500).json({ error: 'GitHub OAuth not configured on the server' });
    }

    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/github/callback`;
    // Request 'repo' scope to create issues and read repos
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=repo&state=${state}`;

    res.redirect(githubAuthUrl);
});

// OAuth Callback Endpoint
app.get('/api/auth/github/callback', async (req: Request, res: Response): Promise<any> => {
    const code = req.query.code as string;
    const state = req.query.state as string;

    if (!code || !state) {
        return res.status(400).send('Missing code or state');
    }

    try {
        const decodedState = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
        const { userId, provider } = decodedState;

        const clientId = process.env.GITHUB_CLIENT_ID;
        const clientSecret = process.env.GITHUB_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            return res.status(500).send('GitHub OAuth not configured on the server');
        }

        const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: clientId,
            client_secret: clientSecret,
            code: code,
        }, {
            headers: {
                Accept: 'application/json'
            }
        });

        const accessToken = tokenResponse.data.access_token;

        if (!accessToken) {
            return res.status(400).send('Failed to obtain access token from GitHub');
        }

        if (supabase) {
            const { error } = await supabase
                .from('user_preferences')
                .upsert({ user_id: userId, github_token: accessToken }, { onConflict: 'user_id' });

            if (error) {
                console.error('[Gateway] Error saving token to Supabase:', error);
                return res.status(500).send('Failed to save GitHub token securely');
            }
        } else {
            console.warn('[Gateway] Supabase not configured. Cannot save token.');
            return res.status(500).send('Database not configured on server');
        }

        res.send(`
            <html>
                <head><title>Authentication Successful</title></head>
                <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                    <h2>GitHub Authentication Successful!</h2>
                    <p>Your GitHub account has been linked to DevClaw via ${provider}.</p>
                    <p>You can close this window and return to your chat.</p>
                </body>
            </html>
        `);
    } catch (error: any) {
        console.error('[Gateway] OAuth callback error:', error.message);
        res.status(500).send('Authentication failed');
    }
});

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

    if (payload.type === 'repos') {
        if (!supabase) {
            return res.status(200).json({ success: false, message: 'Database not configured on server' });
        }

        const { data, error } = await supabase
            .from('user_preferences')
            .select('github_token')
            .eq('user_id', userId)
            .single();

        if (error || !data || !data.github_token) {
            return res.status(200).json({ success: false, message: 'You need to log in to GitHub first. Use /login to authenticate.' });
        }

        try {
            const response = await axios.get('https://api.github.com/user/repos?sort=updated&per_page=10', {
                headers: {
                    'Authorization': `Bearer ${data.github_token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            const repos = response.data;
            if (repos.length === 0) {
                return res.status(200).json({ success: true, message: 'You have no accessible repositories.' });
            }

            const repoList = repos.map((r: any) => `- ${r.full_name}`).join('\n');
            const message = `Here are your recently updated repositories:\n${repoList}\n\nUse /repo <owner>/<repo> to link one project for tasks.`;
            return res.status(200).json({ success: true, message });
        } catch (error: any) {
            console.error('[Gateway] Error fetching repos:', error.response?.data || error.message);
            return res.status(200).json({ success: false, message: 'Failed to fetch repositories from GitHub.' });
        }
    }

    if (payload.type === 'task') {
        let repo = '';
        let githubToken = process.env.GITHUB_TOKEN || ''; // Fallback to server token if set

        if (supabase) {
            const { data, error } = await supabase
                .from('user_preferences')
                .select('github_repo, github_token')
                .eq('user_id', userId)
                .single();

            if (error || !data) {
                return res.status(200).json({ success: false, message: 'No GitHub repository linked. Please use /repo <owner>/<repo> first. Note: You may need to /login first.' });
            }
            repo = data.github_repo;
            if (data.github_token) {
                githubToken = data.github_token; // Use their personal token if available
            }
        }

        if (repo) {
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
                    return res.status(500).json({ error: 'Failed to create GitHub issue. Ensure the repository exists and your token has correct permissions.' });
                }
            } else {
                console.warn('[Gateway] No GitHub token available to create issue.');
                return res.status(200).json({ success: false, message: 'No GitHub token available. Please /login first.' });
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
