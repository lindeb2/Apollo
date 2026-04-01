FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
ENV WEB_RUNTIME_MODE=dev
ENV WEB_PORT=3000
ENV VITE_DEV_HOST=0.0.0.0
ENV VITE_SERVER_API_BASE=/api
ENV VITE_SERVER_WS_BASE=/ws
EXPOSE 3000
CMD ["sh", "-lc", "set -eu; if [ \"${WEB_RUNTIME_MODE:-dev}\" = \"prod\" ]; then npm run build --workspaces=false; exec npx vite preview --host 0.0.0.0 --port \"${WEB_PORT:-3000}\"; fi; exec npx vite --host 0.0.0.0 --port \"${WEB_PORT:-3000}\""]
