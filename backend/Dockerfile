FROM node:20-alpine

# Public reel metadata only; no cookies, account login or media download.
RUN apk add --no-cache python3 py3-pip && python3 -m venv /opt/reel-extractor \
    && /opt/reel-extractor/bin/pip install --no-cache-dir yt-dlp==2026.8.19
ENV PATH="/opt/reel-extractor/bin:${PATH}"

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared ./shared
COPY backend/package.json ./backend/package.json
RUN npm ci --workspace backend

COPY backend ./backend

EXPOSE 3001

WORKDIR /app/backend

CMD ["npm", "run", "start"]
