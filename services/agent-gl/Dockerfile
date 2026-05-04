FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/agent-gl/package.json services/agent-gl/
RUN npm install --workspace=packages/shared-kernel --workspace=services/agent-gl
COPY packages/shared-kernel packages/shared-kernel
COPY services/agent-gl services/agent-gl
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/agent-gl
CMD ["npx", "tsx", "src/index.ts"]
