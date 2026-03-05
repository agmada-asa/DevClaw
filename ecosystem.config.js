module.exports = {
  apps: [
    {
      name: "openclaw-gateway",
      script: "services/openclaw-gateway/dist/index.js",
      cwd: "/var/www/devclaw",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "orchestrator",
      script: "services/orchestrator/dist/index.js",
      cwd: "/var/www/devclaw",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "openclaw-engine",
      script: "services/openclaw-engine/dist/index.js",
      cwd: "/var/www/devclaw",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "agent-runner",
      script: "services/agent-runner/dist/index.js",
      cwd: "/var/www/devclaw",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "telegram-bot",
      script: "apps/telegram-bot/dist/index.js",
      cwd: "/var/www/devclaw",
      env: {
        NODE_ENV: "production",
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
        GATEWAY_URL:
          process.env.GATEWAY_URL ||
          "http://127.0.0.1:3001/api/ingress/message",
        PUBLIC_URL: process.env.PUBLIC_URL,
        BOT_HTTP_PORT:
          process.env.TELEGRAM_BOT_HTTP_PORT ||
          process.env.BOT_HTTP_PORT ||
          "3002",
      },
    },
    {
      name: "whatsapp-bot",
      script: "apps/whatsapp-bot/dist/index.js",
      cwd: "/var/www/devclaw",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
