FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/agent-eom/package.json services/agent-eom/
RUN npm install --workspace=packages/shared-kernel --workspace=services/agent-eom
COPY packages/shared-kernel packages/shared-kernel
COPY services/agent-eom services/agent-eom
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/agent-eom
CMD ["npx", "tsx", "src/index.ts"]
