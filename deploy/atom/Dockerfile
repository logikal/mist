FROM node:24-slim

ENV npm_config_update_notifier=false
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run cf-typegen && npx react-router typegen && npm run gateway:build
