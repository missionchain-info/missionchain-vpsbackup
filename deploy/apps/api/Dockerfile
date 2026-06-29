FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY package.json package-lock.json turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/sdk/package.json packages/sdk/package.json

RUN npm ci

COPY apps/api apps/api
COPY packages/db packages/db
COPY packages/sdk packages/sdk

RUN npx prisma generate --schema packages/db/prisma/schema.prisma

EXPOSE 4000

CMD ["sh", "-lc", "./node_modules/.bin/tsx apps/api/src/index.ts"]
