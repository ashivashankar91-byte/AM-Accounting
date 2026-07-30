FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/cash-service/package.json services/cash-service/
RUN npm install --workspace=packages/shared-kernel --workspace=services/cash-service
COPY packages/shared-kernel packages/shared-kernel
COPY services/cash-service services/cash-service
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/cash-service
RUN NODE_TLS_REJECT_UNAUTHORIZED=0 npx prisma generate
CMD ["npx", "tsx", "src/index.ts"]
