FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/ml-service/package.json services/ml-service/
RUN npm install --workspace=packages/shared-kernel --workspace=services/ml-service
COPY packages/shared-kernel packages/shared-kernel
COPY services/ml-service services/ml-service
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/ml-service
RUN npx prisma generate
CMD ["npx", "tsx", "src/index.ts"]
