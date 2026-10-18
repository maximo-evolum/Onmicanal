# Archivo: Construye una imagen local reproducible del backend de EVOLUM OS.
FROM node:22.23.3-bookworm-slim

WORKDIR /app/backend-v2

COPY backend-v2/package.json backend-v2/package-lock.json ./
RUN npm ci

COPY backend-v2/ ./
RUN npx prisma generate

COPY docker/backend-entrypoint.sh /usr/local/bin/evolum-backend
RUN chmod 0555 /usr/local/bin/evolum-backend

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/evolum-backend"]
