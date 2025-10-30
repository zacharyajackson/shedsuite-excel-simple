FROM node:18-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY env.sample ./.env.sample

EXPOSE 8080

CMD ["node", "src/server.js"]


