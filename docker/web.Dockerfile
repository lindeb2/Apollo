FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
ARG VITE_SERVER_API_BASE=/api
ARG VITE_SERVER_WS_BASE=/ws
ENV VITE_SERVER_API_BASE=${VITE_SERVER_API_BASE}
ENV VITE_SERVER_WS_BASE=${VITE_SERVER_WS_BASE}
RUN npm run build --workspaces=false

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
