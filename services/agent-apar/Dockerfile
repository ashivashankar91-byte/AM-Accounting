FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/agent-apar/package.json services/agent-apar/
RUN npm install --workspace=packages/shared-kernel --workspace=services/agent-apar
COPY packages/shared-kernel packages/shared-kernel
COPY services/agent-apar services/agent-apar
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/agent-apar
CMD ["npx", "tsx", "src/index.ts"]
