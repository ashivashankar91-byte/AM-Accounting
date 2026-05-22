FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/onboarding-service/package.json services/onboarding-service/
RUN npm install --workspace=packages/shared-kernel --workspace=services/onboarding-service
COPY packages/shared-kernel packages/shared-kernel
COPY services/onboarding-service services/onboarding-service
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/onboarding-service
CMD ["npx", "tsx", "src/index.ts"]
