FROM node:20-alpine
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY .next/standalone ./
COPY .next/static ./.next/static
COPY public ./public
COPY content ./content
ENV NODE_ENV=production
EXPOSE 3002
ENV PORT=3002
CMD ["node", "server.js"]
