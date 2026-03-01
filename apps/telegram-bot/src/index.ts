import { Telegraf } from 'telegraf';
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

bot.on('text', async (ctx) => {
    const payload = {
        chatId: ctx.chat.id,
        userId: ctx.from.id,
        username: ctx.from.username,
        text: ctx.message.text,
        messageId: ctx.message.message_id,
        timestamp: new Date().toISOString()
    };

    try {
        const response = await axios.post(GATEWAY_URL, {
            provider: 'telegram',
            payload
        });

        if (response.status === 200) {
            ctx.reply('Task received and sent to gateway. Evaluating...');
        } else {
            ctx.reply('Gateway accepted the message, but returned an unexpected status.');
        }
    } catch (error) {
        console.error('[Telegram] Error forwarding message to gateway:', error);
        ctx.reply('Failed to forward the message to the central system. Please try again later.');
    }
});

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
