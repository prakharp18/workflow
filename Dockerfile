FROM node:20-slim

# Install system dependencies for Playwright
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

# Build Playwright dependencies and install Chromium
RUN npx playwright install --with-deps chromium

COPY . .
RUN npm run build

# Run the watch daemon
CMD ["node", "dist/cli.js", "watch"]
