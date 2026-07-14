FROM node:20-alpine
WORKDIR /app
COPY .next/standalone/apps/admin ./
COPY .next/standalone/node_modules ./node_modules
COPY .next/standalone/package.json ./package.json
COPY .next/static ./.next/static
COPY public ./public
EXPOSE 3000
CMD ["node", "server.js"]
