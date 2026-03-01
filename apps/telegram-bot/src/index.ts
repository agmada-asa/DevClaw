import { Telegraf, Context } from 'telegraf';
import axios from 'axios';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error('[Telegram] Error: TELEGRAM_BOT_TOKEN is not set in environment.');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

const WELCOME_MESSAGE = `Welcome to DevClaw! 🚀

Here is how to get started:
1. Use /login to link your GitHub account.
2. Use /repo <owner>/<repo> to link the repository you want to work on.
3. Use /task (or /request) followed by your description to create new tasks/issues.

Other useful commands:
/status - Check your current login and linked repository status.
/repos - List the GitHub repositories you have access to.
/help - Show this message again.`;

// ─── Main message handler ────────────────────────────────────────────────────
// Defined before command registrations so bot.command() can reference it.

export const handleTextMessage = async (ctx: Context<any>) => {
    if (!ctx.message || !('text' in ctx.message)) return;

    const text = ctx.message.text.trim();

    // Handle help locally
    if (text.toLowerCase() === '/help') {
        return ctx.reply(WELCOME_MESSAGE);
    }

    // Handle login command locally
    if (text.toLowerCase() === '/login' || text.toLowerCase() === '/github_login') {
        const userId = ctx.from?.id;
        if (!userId) {
            return ctx.reply('Could not identify your user ID for login.');
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

        const chatId = ctx.chat?.id;
        const loginUrl = `${baseUrl}/api/auth/github?userId=${userId}&provider=telegram&chatId=${chatId}`;
        return ctx.reply(`Please click this link to link your GitHub account: ${loginUrl}\n\nOnce complete, you can use /status to check your connection or /repo <owner>/<repo> to link a project.\n\nNote: If you are running locally, make sure the gateway is accessible or update GATEWAY_URL to a public tunnel.`);
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
        return ctx.reply('Invalid command. Please use /help to see the list of available commands and the setup flow.');
    }

    const payload = {
        chatId: ctx.chat?.id,
        userId: ctx.from?.id,
        username: ctx.from?.username,
        text: text,
        messageId: ctx.message.message_id,
        timestamp: new Date().toISOString(),
        type: isReposListRequest ? 'repos' : (isRepoLinkRequest ? 'repo_link' : (isStatusRequest ? 'status' : 'task'))
    };

    try {
        const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001/api/ingress/message';
        const response = await axios.post(GATEWAY_URL, {
            provider: 'telegram',
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
            ctx.reply(replyMessage);
        } else {
            const errorMessage = response.data?.error || 'Gateway accepted the message, but returned an unexpected status.';
            ctx.reply(errorMessage);
        }
    } catch (error: any) {
        console.error('[Telegram] Error forwarding message to gateway:', error);
        ctx.reply(error.response?.data?.error || 'Failed to forward the message to the central system. Please try again later.');
    }
};

// ─── Command & event registrations ───────────────────────────────────────────

bot.start((ctx) => {
    ctx.reply(WELCOME_MESSAGE);
});

// Register all commands explicitly so Telegraf routes them correctly.
// bot.on('text') alone may not fire for slash commands in some modes.
bot.command('help', (ctx) => ctx.reply(WELCOME_MESSAGE));
bot.command('status', (ctx) => handleTextMessage(ctx));
bot.command('repos', (ctx) => handleTextMessage(ctx));
bot.command('login', (ctx) => handleTextMessage(ctx));
bot.command('github_login', (ctx) => handleTextMessage(ctx));
bot.command('repo', (ctx) => handleTextMessage(ctx));
bot.command('task', (ctx) => handleTextMessage(ctx));
bot.command('request', (ctx) => handleTextMessage(ctx));

// Also keep the generic text handler as a catch-all for any messages
bot.on('text', handleTextMessage);

// ─── Internal HTTP server for proactive Gateway messages ─────────────────────

const httpApp = express();
httpApp.use(express.json());

httpApp.post('/api/send', async (req: express.Request, res: express.Response) => {
    const { chatId, message } = req.body;
    if (!chatId || !message) {
        res.status(400).json({ error: 'Missing chatId or message' });
        return;
    }
    try {
        await bot.telegram.sendMessage(chatId, message);
        res.status(200).json({ success: true });
    } catch (error: any) {
        console.error('[Telegram] Failed to send proactive message:', error.message);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// For testing purposes, we export the bot but only launch if running directly
if (require.main === module) {
    const BOT_HTTP_PORT = process.env.BOT_HTTP_PORT || 3002;
    httpApp.listen(BOT_HTTP_PORT, () => {
        console.log(`[Telegram] Internal HTTP server listening on port ${BOT_HTTP_PORT}`);
    });

    bot.launch().then(() => {
        console.log('[Telegram] Bot started.');
    }).catch((err) => {
        console.error('[Telegram] Failed to start bot:', err);
    });

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

export { bot, httpApp };
