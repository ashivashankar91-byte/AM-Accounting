FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/agent-payroll/package.json services/agent-payroll/
RUN npm install --workspace=packages/shared-kernel --workspace=services/agent-payroll
COPY packages/shared-kernel packages/shared-kernel
COPY services/agent-payroll services/agent-payroll
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/agent-payroll
CMD ["npx", "tsx", "src/index.ts"]
