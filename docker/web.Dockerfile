FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
ENV WEB_PORT=3000
ENV WEB_LISTEN_HOST=0.0.0.0
EXPOSE 3000
CMD ["sh", "-lc", "set -eu; exec npx vite --host 0.0.0.0 --port \"${WEB_PORT:-3000}\""]
