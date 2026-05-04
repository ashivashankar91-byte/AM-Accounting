FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/webhook-service/package.json services/webhook-service/
RUN npm install --workspace=packages/shared-kernel --workspace=services/webhook-service
COPY packages/shared-kernel packages/shared-kernel
COPY services/webhook-service services/webhook-service
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/webhook-service
RUN NODE_TLS_REJECT_UNAUTHORIZED=0 npx prisma generate
CMD ["npx", "tsx", "src/index.ts"]
