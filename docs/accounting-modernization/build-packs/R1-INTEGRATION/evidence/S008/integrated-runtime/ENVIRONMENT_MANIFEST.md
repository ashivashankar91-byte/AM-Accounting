# S008 Integrated-Runtime Certification — Environment Manifest

**Date**: 2026-07-29
**Step**: R1 Controlled Integration, Step 1C
**Source SHA built**: `dac08589892e67c4be2908fd9bd18e0be8316f33` (r1-integration, post-Step-1B)
**Compose project name**: `amacc-r1int-s008-cert`
**Compose files**: `docker-compose.yml` + `docker-compose.r1int-s008-cert.override.yml` (both local-only, not committed)

## Topology

10 containers, all built from the current `r1-integration` worktree (build context `.`, Dockerfiles under `services/*/Dockerfile` / `apps/web/Dockerfile`), all on the dedicated `amacc-r1int-s008-cert_default` network, none shared with any other running stack.

| Service | Host port | Container port | Image | Built |
|---|---|---|---|---|
| postgres | 53433 | 5432 | postgres:15 (official) | n/a (pulled) |
| redis | 53680 | 6379 | redis:7-alpine (official) | n/a (pulled) |
| rabbitmq | 53672 / 53673 | 5672 / 15672 | rabbitmq:3-management-alpine (official) | n/a (pulled) |
| auth-service | 53001 | 3001 | amacc-r1int-s008-cert-auth-service | fresh, from r1-integration |
| tenant-service | 53002 | 3002 | amacc-r1int-s008-cert-tenant-service | fresh, from r1-integration |
| coa-service | 53016 | 3016 | amacc-r1int-s008-cert-coa-service | fresh, from r1-integration |
| gl-service | 53010 | 3010 | amacc-r1int-s008-cert-gl-service | fresh, from r1-integration |
| audit-service | 53031 | 3031 | amacc-r1int-s008-cert-audit-service | fresh, from r1-integration |
| api-gateway | 53100 | 3000 | amacc-r1int-s008-cert-api-gateway | fresh, from r1-integration |
| web | 53174 | 5174 | amacc-r1int-s008-cert-web | fresh, from r1-integration |

`api-gateway`'s `depends_on` was trimmed via `!override` from the base file's ~20-service list to exactly the 5 services above (auth/tenant/coa/gl/audit) — the base `docker-compose.yml` depends_on pulls in unrelated services (payroll, apar, recon, schedule, agents, etc.) not needed for the S008/Golden-R0 golden-path journeys.

## Isolation proof

- Database: fresh named volume `amacc-r1int-s008-cert_pgdata`, empty (`\dt` returned "Did not find any relations") before migration replay — never touched by any other stack.
- Network: containers attached **only** to `amacc-r1int-s008-cert_default` (verified via `docker inspect .NetworkSettings.Networks`) — not reachable from, or able to reach, the long-lived Final-R0 (13xxx) or Golden-R0-cert (33xxx) stacks' networks.
- Internal DNS: `DATABASE_URL`/`REDIS_URL`/`RABBITMQ_URL` inside every service resolve `postgres`/`redis`/`rabbitmq` to this project's own containers only (verified via `getent hosts postgres` inside `auth-service`).
- Content proof: `docker exec amacc-r1int-s008-cert-coa-service-1 ls prisma/migrations/` and the `auth-service` equivalent both show the S008 migrations present inside the built images.
- Ports: all host ports remapped into the unused 53xxx range (verified free via `docker ps` before provisioning); zero port collisions with the already-running final-r0/golden-r0-cert/am-accounting-base stacks.

## Full image IDs (sha256, `docker images --no-trunc`)

```
amacc-r1int-s008-cert-web: sha256:0a07609d408aede99215df4df21c167b009de33b90198a561786c846448f0ee7
amacc-r1int-s008-cert-gl-service: sha256:143951f9fbd6fd7e03c6214cce1be671e6b51237dab988ae01e5ae80da7f1e2b
amacc-r1int-s008-cert-auth-service: sha256:a2e65de10ba12f87e6908cd3fd8b0aeaba34c1557ec5977e2d70f96069427f96
amacc-r1int-s008-cert-tenant-service: sha256:3f49c0c7df86622be726eda7c36dec1b68e20f3340277e2a1a4df39505073c9d
amacc-r1int-s008-cert-audit-service: sha256:d7e9bcf34c36c72725cf8da5beaef2b03a4188c3eed206076d1e343a1c9be415
amacc-r1int-s008-cert-coa-service: sha256:47b6eb10533a735e9bb534839fa184e4b5dff1d70febe8430ff430d6db14af2d
amacc-r1int-s008-cert-api-gateway: sha256:6463d3b619971c8fb5e09a602835012a0adca006b6234aeb22e5d72e17f1ed6c
```

## Secrets

Throwaway dev-only secrets generated per-run (`AMACC_JWT_SECRET`, `JWT_SECRET`, `ADMIN_API_KEY`), never committed, scoped to this isolated stack's lifetime only.
