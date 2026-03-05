import axios from 'axios';
import { Channel, SendResult } from './types';

export type { Channel };

// Per-platform character limits for outgoing messages.
// Telegram: 4096 chars. WhatsApp: 65536 chars (practical limit ~4096 for readability).
// When a message exceeds the limit it is truncated with a notice so the user
// knows to check the PR directly rather than silently receiving a cut-off message.
const MAX_LENGTH: Record<Channel, number> = {
  telegram: 4096,
  whatsapp: 4096,
};
const TRUNCATION_SUFFIX = '\n\n[Message truncated — see the PR for the full summary.]';

// How many times to retry a failed send before giving up.
// Covers transient bot restarts or brief network blips.
// Does not retry on missing bot URL (misconfiguration, not transient).
const MAX_SEND_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// Truncates a message to the channel's character limit.
// Keeps the suffix within the limit so the final message always fits.
function truncate(message: string, channel: Channel): string {
  const limit = MAX_LENGTH[channel];
  if (message.length <= limit) return message;
  return message.slice(0, limit - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}

// Maps each channel to its bot's internal HTTP URL env var.
// Each bot runs an Express server with POST /api/send that accepts { chatId, message }.
// Adding a new channel: add it to the Channel union in types.ts and add an entry here.
const BOT_URL: Record<Channel, string | undefined> = {
  telegram: process.env.TELEGRAM_BOT_URL,
  whatsapp: process.env.WHATSAPP_BOT_URL,
};

// Sends any message to a user on their messaging platform.
// Used both for approval cards (orchestrator) and change summaries (agent-runner).
//
// Parameters:
//   channel — 'telegram' or 'whatsapp'
//   chatId  — the platform-specific chat identifier from the original request
//   message — the text to send (plain text; bots handle any formatting)
//
// Returns a SendResult so callers know exactly why a delivery failed.
// Never throws — callers shouldn't fail a task just because a notification
// couldn't be delivered, but they can log or persist the failure reason.
export async function sendToUser(
  channel: Channel,
  chatId: string,
  message: string,
): Promise<SendResult> {
  const botUrl = BOT_URL[channel];

  if (!botUrl) {
    console.warn(
      `[notifier] No bot URL configured for channel "${channel}". ` +
      `Set ${channel.toUpperCase()}_BOT_URL in .env to enable notifications.`,
    );
    return { ok: false, reason: 'no_bot_url' };
  }

  const safeMessage = truncate(message, channel);
  if (safeMessage !== message) {
    console.warn(`[notifier] Message to ${channel} chat ${chatId} was truncated to ${MAX_LENGTH[channel]} chars.`);
  }

  let lastErr: any;
  for (let attempt = 1; attempt <= 1 + MAX_SEND_RETRIES; attempt++) {
    try {
      await axios.post(`${botUrl}/api/send`, { chatId, message: safeMessage });
      console.log(`[notifier] Sent message to ${channel} chat ${chatId}`);
      return { ok: true };
    } catch (err: any) {
      lastErr = err;
      if (attempt <= MAX_SEND_RETRIES) {
        console.warn(
          `[notifier] Send attempt ${attempt} failed for ${channel} chat ${chatId}, retrying in ${RETRY_DELAY_MS}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  console.error(
    `[notifier] All ${1 + MAX_SEND_RETRIES} attempts failed for ${channel} chat ${chatId}:`,
    lastErr?.message,
  );
  return { ok: false, reason: 'send_failed', error: lastErr?.message };
}

// Formats and sends a summary of code changes made by the agent-runner back
// to the user. Call this after a task_run transitions to 'completed'.
//
// Parameters:
//   channel     — messaging platform
//   chatId      — platform-specific chat identifier
//   issueNumber — the GitHub issue number the task was linked to
//   repo        — "owner/repo"
//   prUrl       — URL of the pull request that was opened
//   summary     — short human-readable description of what changed
export async function sendChangeSummary(opts: {
  channel: Channel;
  chatId: string;
  issueNumber: number;
  repo: string;
  prUrl: string;
  summary: string;
}): Promise<SendResult> {
  const { channel, chatId, issueNumber, repo, prUrl, summary } = opts;

  const message = [
    `✅ Changes are ready for issue #${issueNumber} in \`${repo}\`:`,
    prUrl,
    '',
    '📝 Summary:',
    summary,
    '',
    'Review and merge the pull request above when you\'re happy with the changes.',
  ].join('\n');

  return sendToUser(channel, chatId, message);
}
