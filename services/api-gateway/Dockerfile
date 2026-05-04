FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/api-gateway/package.json services/api-gateway/
RUN npm install --workspace=packages/shared-kernel --workspace=services/api-gateway
COPY packages/shared-kernel packages/shared-kernel
COPY services/api-gateway services/api-gateway
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/api-gateway
CMD ["npx", "tsx", "src/index.ts"]
