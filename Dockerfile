# Smidzināšanas logs – one container: API + built web app. Needs a persistent volume at /data.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DB_PATH=/data/spray.sqlite
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server -w shared --include-workspace-root=false && npm cache clean --force
COPY shared shared
COPY server server
COPY --from=build /app/web/dist web/dist
RUN mkdir -p /data
VOLUME /data
EXPOSE 8787
CMD ["npm", "start"]
