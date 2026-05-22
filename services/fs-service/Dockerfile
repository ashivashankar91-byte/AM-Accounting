FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY services/fs-service/package.json services/fs-service/
RUN npm install --workspace=packages/shared-kernel --workspace=services/fs-service
COPY packages/shared-kernel packages/shared-kernel
COPY services/fs-service services/fs-service
RUN npm -w packages/shared-kernel run build
WORKDIR /app/services/fs-service
RUN NODE_TLS_REJECT_UNAUTHORIZED=0 npx prisma generate
RUN npx tsc
CMD ["node", "dist/index.js"]
