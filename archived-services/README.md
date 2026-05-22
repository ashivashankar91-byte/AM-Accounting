# Archived Services

These services were archived during Wave 5 (Stabilization Sprint) on 2026-05-01.
They have no COBOL equivalent, no Phase 1 business requirement, or their functionality
is fully covered by other services.

They can be revived for Wave 6+ if needed.

| Service | Reason Archived |
|---------|----------------|
| esg-service | No COBOL equivalent. ESG reporting not in Phase 1 scope. |
| revenue-service | Revenue tracking handled by gl-service income statement queries. |
| ml-service | ML inference handled by agent-* services via Claude API (MOCK_CASHFLOW_HISTORY, MOCK_DEALS removed). |
| data-quality-service | Data quality alerting absorbed into compliance-service rule engine. |
