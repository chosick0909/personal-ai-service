FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
RUN npm ci --workspace frontend

COPY frontend ./frontend
RUN npm run build --workspace frontend

EXPOSE 8080

WORKDIR /app/frontend

CMD ["npm", "run", "start"]
