FROM node:20-bookworm-slim AS builder

WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/sdk/package.json packages/sdk/package.json

RUN npm ci

COPY apps/web apps/web
COPY packages/sdk packages/sdk

RUN npm run build --workspace @missionchain/web

FROM nginx:alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /workspace/apps/web/out /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
