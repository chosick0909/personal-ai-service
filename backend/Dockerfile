FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
RUN npm ci --workspace backend

COPY backend ./backend

EXPOSE 3001

WORKDIR /app/backend

CMD ["npm", "run", "dev"]
