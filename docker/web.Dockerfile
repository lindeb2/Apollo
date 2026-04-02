FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
CMD ["sh", "-lc", "set -eu; exec npx vite --host \"$WEB_LISTEN_HOST\" --port \"$WEB_PORT\""]
