# Migration-orchestration fix (STABILIZE THE CONSOLIDATED ACCOUNTING
# APPLICATION): one-shot image that applies every service's Prisma
# migrations to the shared `amacc` database via scripts/migrate-all.sh, as
# the privileged `amacc` superuser (never the least-privilege `amacc_app`
# runtime role — see infra/postgres/init/01-create-app-role.sql). Wired
# into docker-compose.yml as the `migrator` service; every app service with
# its own migrations depends on it via `condition: service_completed_successfully`,
# so `docker compose up` alone takes a brand-new developer from an empty
# database to a running application with no manual migration step.
FROM node:20-alpine
RUN apk add --no-cache openssl bash
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages packages
COPY services services
RUN npm install --workspaces --if-present
COPY scripts/migrate-all.sh scripts/migrate-all.sh
RUN chmod +x scripts/migrate-all.sh
CMD ["bash", "scripts/migrate-all.sh"]
