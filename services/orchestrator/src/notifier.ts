import axios from 'axios';
import { Channel } from './types';

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
// Returns true if the message was delivered, false if the bot URL is not
// configured or the send request failed. Never throws — callers shouldn't
// fail a task just because a notification couldn't be delivered.
export async function sendToUser(
  channel: Channel,
  chatId: string,
  message: string,
): Promise<boolean> {
  const botUrl = BOT_URL[channel];

  if (!botUrl) {
    console.warn(
      `[notifier] No bot URL configured for channel "${channel}". ` +
      `Set ${channel.toUpperCase()}_BOT_URL in .env to enable notifications.`,
    );
    return false;
  }

  try {
    await axios.post(`${botUrl}/api/send`, { chatId, message });
    console.log(`[notifier] Sent message to ${channel} chat ${chatId}`);
    return true;
  } catch (err: any) {
    console.error(
      `[notifier] Failed to send message to ${channel} chat ${chatId}:`,
      err.message,
    );
    return false;
  }
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
}): Promise<boolean> {
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
