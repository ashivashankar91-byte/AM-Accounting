FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/data-quality-service/package.json services/data-quality-service/
RUN npm install --workspace=packages/shared-kernel --workspace=services/data-quality-service
COPY packages/shared-kernel packages/shared-kernel
COPY services/data-quality-service services/data-quality-service
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/data-quality-service
RUN npx prisma generate
CMD ["npx", "tsx", "src/index.ts"]
