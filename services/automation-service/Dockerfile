FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/automation-service/package.json services/automation-service/
RUN npm install --workspace=packages/shared-kernel --workspace=services/automation-service
COPY packages/shared-kernel packages/shared-kernel
COPY services/automation-service services/automation-service
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/automation-service
RUN NODE_TLS_REJECT_UNAUTHORIZED=0 npx prisma generate
CMD ["npx", "tsx", "src/index.ts"]
