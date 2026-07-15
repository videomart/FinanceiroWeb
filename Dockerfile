FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
COPY config.example.json ./config.example.json

EXPOSE 3002

CMD ["node", "server.js"]
