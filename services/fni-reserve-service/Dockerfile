FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/fni-reserve-service/package.json services/fni-reserve-service/
RUN npm install --workspace=packages/shared-kernel --workspace=services/fni-reserve-service
COPY packages/shared-kernel packages/shared-kernel
COPY services/fni-reserve-service services/fni-reserve-service
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/fni-reserve-service
# NODE_TLS_REJECT_UNAUTHORIZED=0 is build-time only — required on networks with
# SSL-inspecting proxies so Prisma can download its engine binaries.
RUN NODE_TLS_REJECT_UNAUTHORIZED=0 npx prisma generate
CMD ["npx", "tsx", "src/index.ts"]
