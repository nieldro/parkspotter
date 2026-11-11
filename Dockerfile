# ParkSpotter: un solo contenedor (API + app web instalable). Sirve en Render, Railway, Fly.io, etc.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci
COPY client client
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace=server
COPY server server
COPY --from=build /app/client/web client/web
EXPOSE 3000
CMD ["node", "server/src/index.js"]
