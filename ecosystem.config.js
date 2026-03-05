module.exports = {
  apps: [
    {
      name: 'openclaw-gateway',
      script: 'services/openclaw-gateway/dist/index.js',
      cwd: '/var/www/devclaw',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'orchestrator',
      script: 'services/orchestrator/dist/index.js',
      cwd: '/var/www/devclaw',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'openclaw-engine',
      script: 'services/openclaw-engine/dist/index.js',
      cwd: '/var/www/devclaw',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'agent-runner',
      script: 'services/agent-runner/dist/index.js',
      cwd: '/var/www/devclaw',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
