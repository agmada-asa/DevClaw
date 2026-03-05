import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import axios from 'axios';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001/api/ingress/message';

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const BOT_GATEWAY_TIMEOUT_MS = parsePositiveInt(process.env.BOT_GATEWAY_TIMEOUT_MS, 20 * 60 * 1000);
const BOT_GATEWAY_APPROVAL_TIMEOUT_MS = parsePositiveInt(
    process.env.BOT_GATEWAY_APPROVAL_TIMEOUT_MS,
    4 * 60 * 60 * 1000
);
const BOT_GATEWAY_REFINE_TIMEOUT_MS = parsePositiveInt(
    process.env.BOT_GATEWAY_REFINE_TIMEOUT_MS,
    20 * 60 * 1000
);

const resolveGatewayTimeoutMs = (type: string): number => {
    if (type === 'approve') {
        return BOT_GATEWAY_APPROVAL_TIMEOUT_MS;
    }
    if (type === 'refine') {
        return BOT_GATEWAY_REFINE_TIMEOUT_MS;
    }
    return BOT_GATEWAY_TIMEOUT_MS;
};

// Initialize the WhatsApp client with LocalAuth to persist session so we don't scan QR every time
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

client.on('qr', (qr) => {
    // Generate QR code in the terminal
    console.log('[WhatsApp] Receive QR code for login. Please scan it with WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('[WhatsApp] Client is ready!');
});

const WELCOME_MESSAGE = `Welcome to DevClaw! 🚀

Here is how to get started:
1. Use /login to link your GitHub account.
2. Use /repo <owner>/<repo> to link the repository you want to work on.
3. Use /task (or /request) followed by your description to create new tasks/issues.

Other useful commands:
/status - Check your current login and linked repository status.
/repos - List the GitHub repositories you have access to.
/help - Show this message again.`;

export const handleMessage = async (message: any) => {
    // Ignore updates from statuses
    if (message.isStatus) return;

    // Ignore messages that are not standard text
    if (message.type !== 'chat') return;

    const text = message.body.trim();

    // Handle login command locally
    if (text.toLowerCase() === '/login' || text.toLowerCase() === '/github_login') {
        const contact = await message.getContact();
        const userId = contact.number;
        if (!userId) {
            return message.reply('Could not identify your user ID for login.');
        }

        // Use PUBLIC_URL if provided, else fallback to parsing GATEWAY_URL
        let baseUrl = process.env.PUBLIC_URL || 'http://localhost:3001';
        if (!process.env.PUBLIC_URL) {
            const gatewayUrlStr = process.env.GATEWAY_URL || 'http://localhost:3001/api/ingress/message';
            try {
                const parsedUrl = new URL(gatewayUrlStr);
                baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
            } catch (e) {
                // Fallback
            }
        }

        const loginUrl = `${baseUrl}/api/auth/github?userId=${userId}&provider=whatsapp&chatId=${userId}`;
        return message.reply(`Please click this link to link your GitHub account: ${loginUrl}\n\nOnce complete, you can use /status to check your connection or /repo <owner>/<repo> to link a project.\n\nNote: If you are running locally, make sure the gateway is accessible or update GATEWAY_URL to a public tunnel.`);
    }

    if (text.toLowerCase() === '/start' || text.toLowerCase() === '/help') {
        return message.reply(WELCOME_MESSAGE);
    }

    const tLower = text.toLowerCase();
    const isTaskRequest = tLower.startsWith('/task ') || tLower === '/task' ||
        tLower.startsWith('/request ') || tLower === '/request';

    const isRepoLinkRequest = tLower.startsWith('/repo ') || tLower === '/repo';
    const isReposListRequest = tLower === '/repos';
    const isStatusRequest = tLower === '/status';

    const isApproveRequest = tLower.startsWith('/approve ') || tLower === '/approve';
    const isRejectRequest = tLower.startsWith('/reject ') || tLower === '/reject';
    const isRefineRequest = tLower.startsWith('/refine ') || tLower === '/refine';

    if (!isTaskRequest && !isRepoLinkRequest && !isReposListRequest && !isStatusRequest &&
        !isApproveRequest && !isRejectRequest && !isRefineRequest) {
        return message.reply('Invalid command. Please use /help to see the list of available commands and the setup flow.');
    }

    try {
        const contact = await message.getContact();

        const payload = {
            chatId: message.from,
            userId: contact.number,
            username: contact.pushname || contact.name,
            text: text,
            messageId: message.id._serialized,
            timestamp: new Date().toISOString(),
            type: isReposListRequest ? 'repos' :
                isRepoLinkRequest ? 'repo_link' :
                    isStatusRequest ? 'status' :
                        isApproveRequest ? 'approve' :
                            isRejectRequest ? 'reject' :
                                isRefineRequest ? 'refine' : 'task'
        };

        const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001/api/ingress/message';
        const response = await axios.post(GATEWAY_URL, {
            provider: 'whatsapp',
            payload
        }, {
            timeout: resolveGatewayTimeoutMs(payload.type),
        });

        if (response.status === 200) {
            let replyMessage = response.data?.message;
            if (!replyMessage) {
                if (isReposListRequest) {
                    replyMessage = 'Repository list request sent to gateway.';
                } else if (isRepoLinkRequest) {
                    replyMessage = 'Repository link request sent to gateway.';
                } else if (isStatusRequest) {
                    replyMessage = 'Status request sent to gateway.';
                } else if (isApproveRequest) {
                    replyMessage = 'Approval sent to gateway.';
                } else if (isRejectRequest) {
                    replyMessage = 'Rejection sent to gateway.';
                } else if (isRefineRequest) {
                    replyMessage = 'Refinement request sent to gateway. Evaluating...';
                } else {
                    replyMessage = 'Task received and sent to gateway. Evaluating...';
                }
            }
            await message.reply(replyMessage);
        } else {
            const errorMessage = response.data?.error || 'Gateway accepted the message, but returned an unexpected status.';
            await message.reply(errorMessage);
        }

    } catch (error: any) {
        console.error('[WhatsApp] Error processing incoming message:', error);
        await message.reply(error.response?.data?.error || 'Failed to forward the message to the central system. Please try again later.');
    }
};

client.on('message', handleMessage);

// Internal HTTP server for receiving proactive messages from Gateway
const httpApp = express();
httpApp.use(express.json());

httpApp.post('/api/send', async (req: express.Request, res: express.Response) => {
    const { chatId, message } = req.body;
    if (!chatId || !message) {
        res.status(400).json({ error: 'Missing chatId or message' });
        return;
    }
    try {
        // WhatsApp chatId format: '<number>@c.us' for individuals
        const formattedId = chatId.includes('@') ? chatId : `${chatId}@c.us`;
        await client.sendMessage(formattedId, message);
        res.status(200).json({ success: true });
    } catch (error: any) {
        console.error('[WhatsApp] Failed to send proactive message:', error.message);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Always start the internal HTTP server so the Gateway can send proactive messages
const BOT_HTTP_PORT = process.env.BOT_HTTP_PORT || 3003;
httpApp.listen(BOT_HTTP_PORT, () => {
    console.log(`[WhatsApp] Internal HTTP server listening on port ${BOT_HTTP_PORT}`);
});

// Only initialize the client and register shutdown hooks when running directly
if (require.main === module) {
    client.initialize().catch(err => {
        console.error('[WhatsApp] Failed to initialize client:', err);
    });

    // Graceful shutdown
    process.once('SIGINT', async () => {
        console.log('[WhatsApp] Shutting down...');
        await client.destroy();
        process.exit(0);
    });
}

export { client, httpApp };
