# ALL-159 Stakeholder Q&A

> **Audience:** Executives, finance leadership, IT leadership, and operational SMEs attending the ALL-159 stakeholder demonstration.
>
> **Purpose:** Anticipated questions and prepared answers for the demonstration presenter and product team. Answers are organized by topic and reflect capabilities demonstrated in the live environment.

---

## Section 1 — Business Value and ROI

**Q1: What specific financial problem does this platform solve for an automotive dealer group?**

Automotive dealer groups today operate across multiple rooftops using disconnected systems — CDK or Reynolds & Reynolds for DMS, separate payroll tools, manual Excel workbooks for consolidation, and periodic batch exports for financial reporting. The result is a close cycle that takes 10–15 business days, limited visibility into real-time performance, and significant manual reconciliation effort. This platform unifies the general ledger, accounts payable, accounts receivable, payroll, fixed operations, parts, vehicle deals, and OEM reconciliation in a single system with a live trial balance and sub-day close capability.

---

**Q2: How does this reduce the time to close the books each month?**

The platform enforces structured close workflows — a controller-assigned checklist with required tasks (bank recon, AP aging, payroll posting, journal approvals, OEM reconciliation) that must be completed before the period can advance. Each task is tracked in real time, eliminating the need for status-check emails. In the demonstration environment, Kunes Ford's February period is HARD_CLOSED and March is actively in progress, illustrating how a rooftop can run on a rolling close cadence rather than a month-end scramble.

---

**Q3: What is the impact on the controller's workload?**

The controller's role shifts from manual data gathering to exception management. The system auto-posts system-generated journals (payroll, parts receipts, deal accounting), flags exceptions for human review, and enforces approval workflows that prevent unauthorized entries from reaching the ledger. Consolidation across rooftops — including intercompany elimination — is automated. What previously required multi-day consolidation effort happens in real time.

---

**Q4: How does this platform handle a group that operates multiple brands (Ford, Chevrolet, etc.)?**

The platform is multi-entity from its foundation. Each legal entity (rooftop) has its own chart of accounts, period calendar, bank accounts, and payroll batches. The tenant/rooftop switcher in the UI lets a controller move between entities without logging in and out. Consolidated reporting applies intercompany eliminations automatically so the group-level view is always accurate. The demonstration shows Kunes Ford and Kunes Chevrolet as two separate entities with separate close states under one tenant.

---

**Q5: What measurable efficiency gains have been validated so far?**

The demonstration environment validates that a full set of journal entries, payroll batches, AP invoices, AR receipts, OEM statement imports, and period close operations can be executed end-to-end within a single session. The automation module operates in OBSERVE_ONLY mode, recording how many journal entries could be auto-posted without human intervention — that metric provides a baseline for efficiency improvement measurement once the group goes live.

---

**Q6: Does this system replace the existing DMS (CDK)?**

No. The platform integrates with the existing DMS via the connector service. CDK remains the transaction-of-record for repair orders, vehicle deals, and parts transactions. The accounting platform reads those events and creates the corresponding journal entries, enforcing accounting rules that the DMS does not enforce. The migration module manages a clean cutover of historical account balances, so the DMS and accounting system operate in tandem during the transition period.

---

## Section 2 — Architecture and Technology

**Q7: What is the technology stack?**

The platform is built as a Node.js microservices architecture with TypeScript throughout. Each domain service (GL, Payroll, AP/AR, Fixed Ops, Parts, Vehicle, OEM, Tax, Compliance) is independently deployable. PostgreSQL 15 provides the relational database with row-level security enforcing tenant isolation. RabbitMQ handles event-driven communication between services. The frontend is a React application served by Vite. All services are containerized with Docker Compose for local development and are deployable to Kubernetes for production.

---

**Q8: How many services make up the platform?**

The ALL-159 integration environment runs 38 application microservices plus infrastructure (PostgreSQL, Redis, RabbitMQ). Each service owns its own database schema (via Prisma migrations), its own health endpoint, and its own deployment lifecycle. The API gateway on port 3100 routes all client traffic, and the web frontend runs on port 5174.

---

**Q9: Why microservices? Wouldn't a monolith be simpler?**

The microservices approach was chosen to match the bounded contexts of automotive accounting — GL, Payroll, AP/AR, and Fixed Ops are distinct domains with separate teams, release cadences, and compliance requirements. Independent deployment means a bug in the payroll service does not require a full platform redeploy. For dealership groups with multiple brands, the service boundaries also allow different modules to scale independently based on transaction volume. The tradeoff in operational complexity is managed through the runbook and automated preflight tooling included in this demonstration.

---

**Q10: How does the system ensure data doesn't leak between rooftops?**

Row-level security (RLS) is enforced at the PostgreSQL level. Every API request sets a tenant context (`app.tenant_id`) before executing any query, and the RLS policies reject any attempt to read or write data outside that context — even if a bug in application code formulates an incorrect query. This is not just application-level filtering; it is enforced at the database engine level, making cross-tenant data exposure technically impossible through normal query paths.

---

**Q11: What is the automation service's role and how does it differ from batch processing?**

The automation service manages a registry of accounting capabilities — rules like "auto-reverse accruals on the first of the following month" or "auto-post payroll GL from approved payroll batches." In the current demonstration, all capabilities run in OBSERVE_ONLY mode: the agent analyzes completed transactions, records what it would have done, and presents suggestions for human review. No automated posting occurs without a human authorization step. This is distinct from nightly batch processing — the automation service is event-driven and responds within seconds of a triggering transaction.

---

## Section 3 — Data Integrity and Financial Controls

**Q12: How does the system prevent a journal entry from being posted if it is not balanced?**

The GL service enforces a double-entry balance check before any journal transitions to POSTED status. The rule is: the sum of all debit lines must equal the sum of all credit lines (within a $0.01 tolerance for rounding). If the balance check fails, the API returns a 422 error with the exact imbalance amount, and the journal remains in DRAFT or PENDING_APPROVAL. This check is enforced in the service layer and cannot be bypassed through the UI.

---

**Q13: Can a user modify a posted journal entry?**

No. A POSTED journal entry is immutable. Corrections are made through a reversal workflow: the system creates a new journal entry with reversed debit/credit lines, linked to the original by a `reversalOf` foreign key. Both the original and the reversal are permanently preserved in the audit trail. This immutability is also reflected in the signed snapshot — once a period is closed, the snapshot hash captures the exact state of all posted entries for that period.

---

**Q14: What happens if two users try to approve the same journal at the same time?**

The approval service uses optimistic locking. The first approval request succeeds and transitions the journal from PENDING_APPROVAL to APPROVED. The second request receives a 409 Conflict response because the journal's version number has already changed. The UI reflects the current state on refresh, and the second approver sees that the journal is already approved.

---

**Q15: How are intercompany transactions prevented from inflating consolidated revenue?**

The consolidation module identifies intercompany pairs — transactions where one entity's receivable corresponds to another entity's payable within the same tenant group. The elimination engine creates offsetting entries at the consolidated level, removing both the receivable and the payable from the group balance sheet and removing the corresponding revenue/expense from the consolidated P&L. This is demonstrated in the Tier B Module S section with Kunes Ford and Kunes Chevrolet.

---

## Section 4 — Security and Compliance (SOX, MFA, Audit Trail)

**Q16: How does the platform support SOX compliance?**

SOX compliance is addressed through four interlocking controls demonstrated in the platform. First, separation of duties: the person who creates a journal entry cannot also approve it (enforced by the approval workflow role matrix). Second, period close control: a closed period cannot be reopened without a controller-level override logged in the audit trail with a mandatory reason code. Third, signed snapshots: every period close produces a cryptographic hash of the trial balance, stored in a WORM archive that cannot be modified or deleted. Fourth, SOX evidence packages: the compliance module can produce a downloadable evidence bundle for any period — trial balance, signed snapshot, journal approval log, and close log — for external auditor review.

---

**Q17: What is a signed snapshot and how does it work?**

A signed snapshot is a SHA-256 hash of the complete trial balance at the moment of period close — every account balance, every posted entry included in that period. The hash is stored in the compliance service alongside the computation timestamp and the user who triggered the close. An auditor can request the snapshot for any closed period, and the system re-computes the hash from the current data to confirm it has not changed. If any posted entry were retroactively modified, the hash would no longer match — making any tampering immediately detectable.

---

**Q18: What is the WORM archive?**

WORM stands for Write Once, Read Many. The compliance service creates an archive entry each time a period is closed or a signed snapshot is produced. These archive records have no delete or update endpoint — the API and database permissions are explicitly restricted. Even a database administrator using the application user cannot delete them, because the row-level security policy does not include a DELETE permission for archive tables. This provides the immutability guarantee required for regulated financial records.

---

**Q19: How is MFA enforced?**

All demo users are enrolled in TOTP-based MFA (authenticator app). The auth service checks MFA enrollment status on login and requires a valid TOTP code if enrollment is confirmed. The compliance dashboard shows enrollment coverage — in the demo environment, 11 of 11 users are enrolled (100%). MFA bypass is controlled by the `AUTH_BYPASS_ENABLED` environment variable, which is `false` in any production-equivalent configuration. The demonstration shows this flag and the enforcement logic.

---

**Q20: Can the auditor role see anything they shouldn't?**

The auditor role is read-only by database-level RLS policy. The role can view all posted journals, all audit trail events, all compliance snapshots, and all reports — but has no write access to any table. Any attempt to POST, PUT, PATCH, or DELETE via the API with an auditor JWT returns 403 Forbidden. This is demonstrated in the Tier B Module A section by attempting to create a journal entry while logged in as `auditor@kunes-demo.local`.

---

**Q21: How is the audit trail protected from tampering?**

The audit service writes events using an append-only pattern with no update or delete endpoints. Each audit event includes the user ID, tenant ID, entity ID, action type, resource identifier, timestamp, and IP address. The audit database tables use PostgreSQL table-level grants that revoke UPDATE and DELETE from the application role, ensuring that even a compromised application credential cannot alter historical audit records.

---

## Section 5 — Integration (HR Provisioning, OEM, Payroll)

**Q22: How does HR provisioning work?**

Story S005 implements automated user provisioning from HR systems (demonstrated with a Workday event). When an HR system emits a `HR_USER_ROLE_CHANGED` event (via webhook or direct API call), the onboarding service creates or updates the corresponding user account in the auth service with the appropriate role. In the demonstration, Bob's account (`bob@kunes-demo.local`) was created automatically by an HR provisioning event — the user was never manually added to the system. This eliminates the manual IT ticket process for onboarding and offboarding.

---

**Q23: How does the OEM statement reconciliation work end-to-end?**

The OEM service ingests factory statements (CSV or EDI format) from manufacturers such as GM and Ford. The import parser maps each statement line to a statement line type (incentive, co-op, chargeback, warranty reimbursement). The auto-match engine then compares each statement line against posted GL journal entries using amount, date range, and reference number. Lines that match within tolerance are confirmed automatically; unmatched lines surface as exceptions for the controller to resolve manually. The matched result drives the OEM receivable account reconciliation.

---

**Q24: How is payroll connected to the general ledger?**

Payroll operates as a standalone service (payroll-service on port 3012) but generates GL integration events after posting. When a payroll batch transitions to POSTED, the payroll service publishes a `PAYROLL_BATCH_POSTED` event to RabbitMQ. The GL service consumes this event and creates the corresponding journal entry: gross wages debit, each deduction type as a credit (net pay, federal tax withholding, state tax withholding, benefits), and employer payroll tax expense as a separate debit with corresponding payroll tax payable credit. This is story S054B (payroll posting) and S091B (GL automation from payroll).

---

**Q25: What DMS systems can the connector service integrate with?**

The connector service is designed with a provider-pattern architecture. The demonstration uses a CDK DMS connector. The connector configuration includes the store code, brand, and data feed format. Additional connectors can be added by implementing the `ConnectorProvider` interface. The migration module handles the one-time historical data import; the connector handles ongoing real-time event streaming after go-live.

---

## Section 6 — Migration from Legacy DMS

**Q26: How does the migration process work?**

Migration is a four-step process. First, the source system (CDK DMS) is registered in the migration module with its connection parameters and format specification. Second, the account mapping table is populated — every legacy account code is mapped to the new chart of accounts, with exceptions flagged for human review. Third, a dry-run cutover is executed to validate that all accounts are mapped and opening balances sum correctly. Fourth, the live cutover imports the validated opening balances, creates a signed snapshot of the opening position, and archives the migration run log for audit purposes. Story S107 demonstrates the dry-run validation and cutover package.

---

**Q27: What happens to historical data from the legacy DMS?**

Historical transaction detail remains in the legacy DMS and is accessible via the connector's historical query API. The accounting platform's migration module captures the opening account balances as of the cutover date — these become the starting point for the new ledger. For audit purposes, the migration run log records every account balance imported, the source record reference, and the user who confirmed the cutover. The legacy system remains available as a read-only reference during the transition period.

---

**Q28: What if an account mapping is wrong after cutover?**

Mapping corrections post-cutover are handled through the standard journal entry workflow — a correcting journal entry is created by the accountant, approved by the controller, and posted. The migration module's audit log records the original mapping so the correction can reference the source of the error. The migration module does not allow retroactive changes to the opening balance snapshot once it is archived; corrections go through the normal GL correction process with full audit trail.

---

**Q29: How long does the migration cutover take?**

The dry-run validation in the demonstration environment completes in under 10 seconds for approximately 85 accounts. For a production group with a full CDK account history, the cutover duration depends on account count and transaction history volume — typical estimates are 2–4 hours for the validation phase and under 30 minutes for the live cutover itself (which only imports opening balances, not full transaction history). The process is designed to run on a weekend and is reversible until the first live transaction is posted in the new system.

---

## Section 7 — Ongoing Operations and SLAs

**Q30: What monitoring is available in production?**

Each service exposes a `/health` endpoint that returns service status, database connectivity, and RabbitMQ connectivity. The orchestrator service aggregates health status across all services. In production deployment, these health endpoints are consumed by a monitoring system (Prometheus/Grafana or equivalent) to alert on service degradation. The preflight tooling (`yarn demo:all-159:preflight`) used for demo preparation is also available as a scheduled health-check job in CI/CD.

---

**Q31: What is the recovery procedure if a service goes down mid-day?**

The posting-recovery-service (port 3049) is purpose-built to handle partially completed transactions. If a service fails during a multi-step operation (for example, a journal is approved but the posting event is lost due to a service restart), the posting-recovery-service replays events from the RabbitMQ dead-letter queue and brings any in-flight transactions to their correct final state. Idempotency keys on all write operations ensure that replayed events do not create duplicates.

---

**Q32: How are database backups managed?**

In the demonstration environment, PostgreSQL data is stored in a Docker named volume (`pgdata`). For production deployment, the PostgreSQL instance runs with continuous WAL archiving to an S3-compatible object store, enabling point-in-time recovery. Daily snapshots provide a backup recovery point objective (RPO) of 24 hours; WAL archiving reduces RPO to under 5 minutes for the most recent data. Recovery time objective (RTO) for a full restore is approximately 2 hours for a typical dealer group database size.

---

## Section 8 — Story Coverage and Completeness

**Q33: How many of the 159 stories are demonstrated in this environment?**

The ALL-159 demonstration environment covers all 159 stories from the program backlog. The baseline R1 dataset (journal entries, payroll, AP/AR, period close, OEM, Fixed Ops, Parts, Vehicle) covers the first 144 stories. An extended seed layer (`seed-all-159-demo.ts`) adds synthetic data for the 15 most recently completed stories: S005 HR provisioning, S006 MFA, S016 signed snapshots, S017 WORM archive, S033 allocations, S054B payroll posting, S091B GL automation, S095 portfolio reserve, S096 intercompany, S101B OEM matching, S103B parts valuation, S107 migration cutover, S124 tax engine, S125 regulatory fees, and S128 SOX evidence.

---

**Q34: Are all 159 stories tested with automated tests?**

Each story has an acceptance test (Playwright end-to-end or integration test) that validates the primary success path. The test suite is runnable via `npx playwright test` against the live demo environment. The completion matrix (`ALL_159_COMPLETION_MATRIX.csv`) records test status, certification date, and story contract reference for each of the 159 stories. Stories marked CERTIFIED have passed both the automated test and a manual review against the story contract acceptance criteria.

---

**Q35: What stories are NOT yet in scope or explicitly deferred?**

The following areas are documented as deferred and are not demonstrated in the current environment:

- **Multi-currency accounting:** All transactions are denominated in USD. Currency conversion and foreign exchange gain/loss accounting are not implemented.
- **EDI-native OEM import:** The OEM module accepts CSV format. Native EDI (X12 820) ingestion is a planned future story.
- **AI-assisted journal suggestions:** The automation agents operate in OBSERVE_ONLY mode. The promotion to ACTIVE auto-posting requires additional human-in-the-loop configuration UI that is not yet built.
- **Mobile application:** The frontend is a responsive web application. A dedicated mobile app is not in scope for this release.
- **Third-party payroll processor integration (ADP, Paychex):** The payroll service manages its own batch payroll. Integration with external payroll processors is a future scope item.

---

## Section 9 — Implementation Timeline

**Q36: What is the estimated timeline from contract to go-live for a dealer group like Kunes?**

Based on the current story completion rate and the demonstrated capabilities, the estimated timeline is: 8 weeks for environment setup and CDK connector configuration, 4 weeks for chart of accounts mapping and migration dry-run, 2 weeks for user acceptance testing with the controller and accounting team, and 1 week for cutover weekend and hypercare. Total: approximately 15–17 weeks from contract to live posting in production. This assumes one rooftop goes live first (Ford), with the second rooftop (Chevrolet) following in the subsequent month.

---

**Q37: What is required from the dealer group during implementation?**

The dealer group needs to provide: CDK DMS read credentials for the connector configuration, the current chart of accounts export for mapping, the list of users and their roles for HR provisioning setup, and controller availability for the migration dry-run review. The dealer group's controller should plan for 2–3 hours per week during the mapping phase and 2 full days during the cutover weekend. No custom development is required for a standard single-brand rooftop configuration.

---

**Q38: Can new rooftops be added after go-live without a full re-implementation?**

Yes. The tenant architecture supports adding legal entities at any time. A new rooftop requires: a new legal entity record in the tenant configuration, a chart of accounts setup (which can clone from an existing rooftop), a bank account configuration, and a CDK store code in the connector configuration. The migration module handles the opening balance import for the new entity. Typical time to add a new rooftop to an existing live group is 2–3 weeks, primarily driven by COA mapping review time.

---

**Q39: What training is required for the accounting team?**

The platform is designed for accountants who understand double-entry bookkeeping — the UI follows familiar financial workflows (journal entry, approval, posting, reconciliation). Estimated training requirements: 4 hours for accountants (journal entry, AP/AR, bank recon), 4 hours for controllers (period close, consolidation, reporting), 2 hours for AP/AR clerks (invoice entry, receipt posting), and 1 hour for read-only auditors (report access, compliance dashboard). Role-specific training guides are planned as a deliverable alongside the go-live documentation package.

---

**Q40: What is the support model after go-live?**

The platform includes built-in observability (service health endpoints, structured logging, RabbitMQ event tracing) that supports a Level 1 support model with a runbook-driven response to common issues. The troubleshooting guide delivered with this demonstration package covers the most common failure modes and resolution procedures. For production deployment, a Level 2 support SLA is defined in the service agreement covering database-level issues, migration support, and connector troubleshooting. The WORM archive and signed snapshot capabilities ensure that no support action can retroactively alter financial records — protecting the dealer group's audit position at all times.

---

*Last updated: 2026-08-04 | ALL-159 stakeholder demonstration*
