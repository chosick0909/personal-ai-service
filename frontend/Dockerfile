FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
RUN npm ci --workspace frontend

COPY frontend ./frontend

EXPOSE 5173

WORKDIR /app/frontend

CMD ["npm", "run", "dev"]
