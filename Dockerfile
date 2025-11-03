FROM node:20-bullseye

# Install Chromium for whatsapp-web.js (via puppeteer)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     chromium \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /usr/src/app

# Install deps first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Create data directory for DB and sessions (mounted as volume in compose)
RUN mkdir -p /data

# Default ports and paths (can be overridden in compose)
ENV PORT=3100 \
    SQLITE_PATH=/data/db.sqlite \
    WWEBJS_DATA_PATH=/data/sessions

EXPOSE 3100

CMD ["npm", "start"]

