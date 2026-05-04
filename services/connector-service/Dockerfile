FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/connector-service/package.json services/connector-service/
RUN npm install --workspace=packages/shared-kernel --workspace=services/connector-service
COPY packages/shared-kernel packages/shared-kernel
COPY services/connector-service services/connector-service
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/connector-service
CMD ["npx", "tsx", "src/index.ts"]
