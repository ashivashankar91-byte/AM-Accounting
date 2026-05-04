FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/revenue-service/package.json services/revenue-service/
RUN npm install --workspace=packages/shared-kernel --workspace=services/revenue-service
COPY packages/shared-kernel packages/shared-kernel
COPY services/revenue-service services/revenue-service
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/revenue-service
RUN npx prisma generate
CMD ["npx", "tsx", "src/index.ts"]
