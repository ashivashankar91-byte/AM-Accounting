FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/orchestrator-service/package.json services/orchestrator-service/
RUN npm install --workspace=packages/shared-kernel --workspace=services/orchestrator-service
COPY packages/shared-kernel packages/shared-kernel
COPY services/orchestrator-service services/orchestrator-service
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/orchestrator-service
RUN NODE_TLS_REJECT_UNAUTHORIZED=0 npx prisma generate
EXPOSE 3048
CMD ["npx", "tsx", "src/index.ts"]
