import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import axios from 'axios';
import dotenv from 'dotenv';

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

        const loginUrl = `${baseUrl}/api/auth/github?userId=${userId}&provider=whatsapp`;
        return message.reply(`Please click this link to link your GitHub account: ${loginUrl}\n\nNote: If you are running locally, make sure the gateway is accessible or update GATEWAY_URL to a public tunnel (e.g. ngrok).`);
    }

    const isTaskRequest = text.toLowerCase().startsWith('/task ') ||
        text.toLowerCase() === '/task' ||
        text.toLowerCase().startsWith('/request ') ||
        text.toLowerCase() === '/request';

    const isRepoLinkRequest = text.toLowerCase().startsWith('/repo ') ||
        text.toLowerCase() === '/repo';

    const isReposListRequest = text.toLowerCase() === '/repos';

    if (!isTaskRequest && !isRepoLinkRequest && !isReposListRequest) {
        return message.reply('To submit a new request, please start your message with /request or /task followed by your task description. Use /repo <owner>/<repo> to link a GitHub repository, or /repos to list your repositories. Use /login to authenticate with GitHub.');
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
            type: isReposListRequest ? 'repos' : (isRepoLinkRequest ? 'repo_link' : 'task')
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

// For testing purposes, export the client
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

export { client };
