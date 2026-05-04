FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/agent-t1/package.json services/agent-t1/
RUN npm install --workspace=packages/shared-kernel --workspace=services/agent-t1
COPY packages/shared-kernel packages/shared-kernel
COPY services/agent-t1 services/agent-t1
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/agent-t1
CMD ["npx", "tsx", "src/index.ts"]
