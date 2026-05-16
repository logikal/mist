FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.gateway.json ./
COPY gateway ./gateway
RUN npm run gateway:build

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/dist ./dist

EXPOSE 8788
CMD ["node", "dist/gateway/server.js"]
