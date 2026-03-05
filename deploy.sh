#!/bin/bash

# Configuration
DROPLET_IP="104.248.173.95"
DROPLET_USER="root"
DEPLOY_DIR="/var/www/devclaw"

echo "Deploying DevClaw to $DROPLET_USER@$DROPLET_IP:$DEPLOY_DIR..."

# 1. SSH in to create the directory if it doesn't exist
echo "Ensuring deployment directory exists..."
ssh -o StrictHostKeyChecking=no $DROPLET_USER@$DROPLET_IP "mkdir -p $DEPLOY_DIR"

# 2. Sync the files using rsync
# We exclude node_modules, .git, and build artifacts to save bandwidth and time.
echo "Syncing files to droplet..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.turbo' \
  --exclude 'dist' \
  --exclude '.next' \
  ./ $DROPLET_USER@$DROPLET_IP:$DEPLOY_DIR/

# 3. SSH in to run build and start commands
echo "Running post-deployment steps on the droplet..."
ssh -o StrictHostKeyChecking=no $DROPLET_USER@$DROPLET_IP << 'EOF'
  cd /var/www/devclaw

  echo "Installing PM2 and Turbo globally (if not present)..."
  npm install -g pm2 turbo

  echo "Installing project dependencies..."
  npm install

  echo "Building backend services..."
  npm run build:servers

  echo "Starting/Restarting services via PM2..."
  pm2 startOrReload ecosystem.config.js --update-env

  echo "Saving PM2 configuration..."
  pm2 save
EOF

echo "Deployment complete!"
