FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code and build
COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app

# Copy package.json and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy built artifacts from the builder stage
COPY --from=builder /app/dist ./dist

# Expose the API port
EXPOSE 3001

# Command to run the application
CMD ["npm", "start"]
