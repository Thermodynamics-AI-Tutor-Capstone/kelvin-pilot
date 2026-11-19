FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3337
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN chmod -R a+rX /app
USER node
EXPOSE 3337
CMD ["node", "server.mjs"]
