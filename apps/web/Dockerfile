FROM node:20-alpine AS builder
WORKDIR /app
COPY apps/web/package.json ./
RUN npm install
COPY apps/web/ ./
ENV API_TARGET=http://api-gateway:80
EXPOSE 5174
CMD ["npx", "vite", "--host", "--port", "5174"]
