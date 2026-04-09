FROM node:20-alpine
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY .next/standalone ./
COPY .next/static ./.next/static
COPY public ./public
ENV NODE_ENV=production
EXPOSE 3001
ENV PORT=3001
CMD ["node", "server.js"]
