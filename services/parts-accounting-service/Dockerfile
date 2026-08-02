FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/parts-accounting-service/package.json services/parts-accounting-service/
RUN npm install --workspace=packages/shared-kernel --workspace=services/parts-accounting-service
COPY packages/shared-kernel packages/shared-kernel
COPY services/parts-accounting-service services/parts-accounting-service
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/parts-accounting-service
RUN npx prisma generate
CMD ["npx", "tsx", "src/index.ts"]
