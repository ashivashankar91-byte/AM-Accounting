FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/esg-service/package.json services/esg-service/
RUN npm install --workspace=packages/shared-kernel --workspace=services/esg-service
COPY packages/shared-kernel packages/shared-kernel
COPY services/esg-service services/esg-service
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/esg-service
RUN npx prisma generate
CMD ["npx", "tsx", "src/index.ts"]
