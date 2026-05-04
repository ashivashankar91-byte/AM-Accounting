FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/notification-service/package.json services/notification-service/
RUN npm install --workspace=packages/shared-kernel --workspace=services/notification-service
COPY packages/shared-kernel packages/shared-kernel
COPY services/notification-service services/notification-service
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/notification-service
CMD ["npx", "tsx", "src/index.ts"]
