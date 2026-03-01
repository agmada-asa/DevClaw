import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import axios from 'axios';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001/api/ingress/message';

// Initialize the WhatsApp client with LocalAuth to persist session so we don't scan QR every time
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
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

        // Ensure GATEWAY_URL is parsed correctly for the base URL
        const gatewayUrlStr = process.env.GATEWAY_URL || 'http://localhost:3001/api/ingress/message';
        let baseUrl = 'http://localhost:3001';
        try {
            const parsedUrl = new URL(gatewayUrlStr);
            baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
        } catch (e) {
            // Fallback
        }

        const loginUrl = `${baseUrl}/api/auth/github?userId=${userId}&provider=whatsapp&chatId=${userId}`;
        return message.reply(`Please click this link to link your GitHub account: ${loginUrl}\n\nOnce complete, you can use /status to check your connection or /repo <owner>/<repo> to link a project.\n\nNote: If you are running locally, make sure the gateway is accessible or update GATEWAY_URL to a public tunnel.`);
    }

    if (text.toLowerCase() === '/start' || text.toLowerCase() === '/help') {
        return message.reply(WELCOME_MESSAGE);
    }

    const isTaskRequest = text.toLowerCase().startsWith('/task ') ||
        text.toLowerCase() === '/task' ||
        text.toLowerCase().startsWith('/request ') ||
        text.toLowerCase() === '/request';

    const isRepoLinkRequest = text.toLowerCase().startsWith('/repo ') ||
        text.toLowerCase() === '/repo';

    const isReposListRequest = text.toLowerCase() === '/repos';
    const isStatusRequest = text.toLowerCase() === '/status';

    if (!isTaskRequest && !isRepoLinkRequest && !isReposListRequest && !isStatusRequest) {
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
            type: isReposListRequest ? 'repos' : (isRepoLinkRequest ? 'repo_link' : (isStatusRequest ? 'status' : 'task'))
        };

        const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001/api/ingress/message';
        const response = await axios.post(GATEWAY_URL, {
            provider: 'whatsapp',
            payload
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

// For testing purposes, export the client
if (require.main === module) {
    const BOT_HTTP_PORT = process.env.BOT_HTTP_PORT || 3003;
    httpApp.listen(BOT_HTTP_PORT, () => {
        console.log(`[WhatsApp] Internal HTTP server listening on port ${BOT_HTTP_PORT}`);
    });

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
