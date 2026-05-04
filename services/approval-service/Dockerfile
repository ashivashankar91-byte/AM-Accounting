FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/approval-service/package.json services/approval-service/
RUN npm install --workspace=packages/shared-kernel --workspace=services/approval-service
COPY packages/shared-kernel packages/shared-kernel
COPY services/approval-service services/approval-service
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/approval-service
CMD ["npx", "tsx", "src/index.ts"]
