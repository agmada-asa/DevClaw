import { Telegraf, Context } from 'telegraf';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001/api/ingress/message';

if (!BOT_TOKEN) {
    console.error('[Telegram] Error: TELEGRAM_BOT_TOKEN is not set in environment.');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
    ctx.reply('Welcome to DevClaw! Tell me what you want to build or fix.');
});

export const handleTextMessage = async (ctx: Context<any>) => {
    if (!ctx.message || !('text' in ctx.message)) return;

    const text = ctx.message.text.trim();
    const isTaskRequest = text.toLowerCase().startsWith('/task ') ||
        text.toLowerCase() === '/task' ||
        text.toLowerCase().startsWith('/request ') ||
        text.toLowerCase() === '/request';

    const isRepoLinkRequest = text.toLowerCase().startsWith('/repo ') ||
        text.toLowerCase() === '/repo';

    if (!isTaskRequest && !isRepoLinkRequest) {
        return ctx.reply('To submit a new request, please start your message with /request or /task followed by your task description. Use /repo <owner>/<repo> to link a GitHub repository.');
    }

    const payload = {
        chatId: ctx.chat?.id,
        userId: ctx.from?.id,
        username: ctx.from?.username,
        text: text,
        messageId: ctx.message.message_id,
        timestamp: new Date().toISOString(),
        type: isRepoLinkRequest ? 'repo_link' : 'task'
    };

    try {
        const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001/api/ingress/message';
        const response = await axios.post(GATEWAY_URL, {
            provider: 'telegram',
            payload
        });

        if (response.status === 200) {
            const replyMessage = response.data?.message || (isRepoLinkRequest ? 'Repository link request sent to gateway.' : 'Task received and sent to gateway. Evaluating...');
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

bot.on('text', handleTextMessage);

// For testing purposes, we export the bot but only launch if running directly
if (require.main === module) {
    bot.launch().then(() => {
        console.log('[Telegram] Bot started.');
    }).catch((err) => {
        console.error('[Telegram] Failed to start bot:', err);
    });

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

export { bot };
