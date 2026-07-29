# S008 Integrated-Runtime — Service Health Report

All 10 containers reached a stable "Up" state (postgres/redis/rabbitmq additionally reported Docker `healthy`) within ~1 minute of `docker compose up -d --build`, with no restarts observed during the certification session.

| Check | Result |
|---|---|
| `GET http://localhost:53001/health` (auth-service, direct) | 200 |
| `GET http://localhost:53002/health` (tenant-service, direct) | 200 |
| `GET http://localhost:53016/health` (coa-service, direct) | 200 |
| `GET http://localhost:53010/health` (gl-service, direct) | 200 |
| `GET http://localhost:53031/health` (audit-service, direct) | 200 |
| `GET http://localhost:53100/health` (api-gateway) | 200 |
| `GET http://localhost:53174/amacc/` (web) | 200, `<title>AMACC — AutoMate Accounting Cloud</title>` present |

Real end-to-end request proof (not just health-endpoint pings): real login (`POST /api/v1/auth/login` through the gateway) returned a real signed JWT; that JWT was then used for 10+ further real, permission-gated write calls (legal entity, fiscal calendar, fiscal year generation, store, 2 GL accounts, journal sources, CLERK role/user/role-assignment) — all succeeded, proving the full gateway → auth-service / tenant-service / coa-service request path is live and correctly wired end to end in this isolated stack.
