FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/auth-service/package.json services/auth-service/
RUN npm install --workspace=packages/shared-kernel --workspace=services/auth-service
COPY packages/shared-kernel packages/shared-kernel
COPY services/auth-service services/auth-service
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/auth-service
RUN NODE_TLS_REJECT_UNAUTHORIZED=0 npx prisma generate
CMD ["npx", "tsx", "src/index.ts"]
