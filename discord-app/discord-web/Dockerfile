FROM node:18-alpine

WORKDIR /app

COPY . .
WORKDIR /app/discord-app/discord-web
RUN npm install
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
