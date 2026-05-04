# AutoMate 2.0 â€” COBOL â†’ TypeScript Traceability Matrix

**Scope:** `acct/src/` (205 production programs)  
**Generated:** Wave 1 + Wave 2 (COPILOT.md protocol)  
**Status key:** ðŸ”´ Not Started Â· ðŸŸ¡ Extracted Â· ðŸ”µ In Development Â· ðŸŸ¢ Complete + Tested

---

## Legend

| Column | Meaning |
|--------|---------|
| COBOL Program | Source filename in `acct/src/` |
| PROGRAM-ID | COBOL program identifier |
| Function | Business function |
| Decision | BUILD / FIX / SKIP / ABSORB |
| Target TS Service | TypeScript service that owns this function |
| Status | See key above |
| Extraction Doc | Link to extraction markdown |
| Intelligence Layer | Net-new capabilities not in COBOL |

---

## Wave 1 â€” General Ledger Core

| COBOL Program | PROGRAM-ID | Function | Decision | Target TS Service | Status | Extraction Doc | Intelligence Layer |
|---|---|---|---|---|---|---|---|
| tranpost.cbl | TRANPOST | Post transaction batches to JRN/DETAIL/HISTTRAN | **FIX + EXTEND** | gl-service | ðŸŸ¢ Complete + Tested | [tranpost.extraction.md](cobol-extractions/tranpost.extraction.md) | SERIALIZABLE TX eliminates OOB; agent review step; COS/INV chain |
| tranup.cbl | TRANUP | Enter/edit transaction lines (screen) | SKIP (screen) | gl-service | ðŸ”´ Not Started | â€” | API replaces screen |
| tranup2.cbl | TRANUP2 | Enter/edit transactions (extended) | SKIP (screen) | gl-service | ðŸ”´ Not Started | â€” | Batch import API |
| komgl.cbl | KOMGL | Komodo GL account query (read-only) | ABSORB | gl-service / coa-service | ðŸ”´ Not Started | â€” | â€” |
| komglbyid.cbl | KOMGLBYID | Komodo GL by ID query | ABSORB | gl-service | ðŸ”´ Not Started | â€” | â€” |
| komtran.cbl | KOMTRAN | Komodo transaction query | ABSORB | gl-service | ðŸ”´ Not Started | â€” | â€” |
| komjrn.cbl | KOMJRN | Komodo journal query | ABSORB | gl-service | ðŸ”´ Not Started | â€” | â€” |
| komsrc.cbl | KOMSRC | Komodo source query | ABSORB | gl-service | ðŸ”´ Not Started | â€” | â€” |
| validate.cbl | VALIDATE | Pre-posting edit validation | ABSORB | gl-service (Zod schemas + GLValidationEngine) | ðŸ”´ Not Started | â€” | AI anomaly detection |
| getgldesc.cbl | GETGLDESC | Read GL account record by GL# | ABSORB | gl-service (accountRepo.findById) | ðŸŸ¢ Absorbed | â€” | â€” |
| getgldistr.cbl | GETGLDISTR | Get GL distribution percentages | BUILD | gl-service (distribution expansion) | ðŸ”´ Not Started | â€” | â€” |
| getglbyid.cbl | GETGLBYID | Map GL ID to account number | ABSORB | coa-service | ðŸ”´ Not Started | â€” | â€” |

---

## Wave 2 â€” Journal Entry / Source

| COBOL Program | PROGRAM-ID | Function | Decision | Target TS Service | Status | Extraction Doc | Intelligence Layer |
|---|---|---|---|---|---|---|---|
| autopost.cbl | AUTOPOST | Automated batch posting trigger | BUILD | gl-service (scheduled job) | ðŸ”´ Not Started | â€” | Event-driven triggers replace cron |
| revadjt.cbl | REVADJT | Reverse/adjust transactions | BUILD | gl-service | ðŸ”´ Not Started | â€” | AI can suggest reversal candidates |
| revtran.cbl | REVTRAN | Reverse transaction | BUILD | gl-service | ðŸ”´ Not Started | â€” | â€” |
| jnlsrcsec.cbl | JNLSRCSEC- | Journal source security | BUILD | gl-service (RBAC) | ðŸ”´ Not Started | â€” | Role-based source access |
| srcup.cbl | SRCUP | Maintain journal sources | BUILD | gl-service / coa-service | ðŸ”´ Not Started | â€” | â€” |
| komdet.cbl | KOMDET | Komodo schedule detail query | ABSORB | gl-service | ðŸ”´ Not Started | â€” | â€” |
| missdocup.cbl | MISSDOCUP | Maintain missing document records | ABSORB | gl-service (historyTransaction count) | ðŸŸ¢ Absorbed | â€” | â€” |

---

## Wave 2 (Period Close) â€” EOM + Year-End

_Extraction wave completed. eom-service fixed + extended. Tests written._

| COBOL Program | PROGRAM-ID | Function | Decision | Target TS Service | Status | Extraction Doc | Intelligence Layer |
|---|---|---|---|---|---|---|---|
| purge.cbl | PURGE | Month-end close orchestrator (10 steps, ACSYS-TRACK-EOM) | FIX + EXTEND | eom-service | ðŸŸ¢ Complete + Tested | [purge.extraction.md](cobol-extractions/purge.extraction.md) | Resumable steps; EOM preview; multi-tenant parallel closes; outbox event |
| caaccteom.cbl | CAACCTEOM | EOM Java UI bridge (no business logic) | SKIP | eom-service | ðŸŸ¢ Complete (SKIP) | [caaccteom.extraction.md](cobol-extractions/caaccteom.extraction.md) | REST API replaces dialog |
| eomsync.cbl | EOMSYNC | HTTP sync trigger at EOJ (fire-and-forget) | SKIP | eom-service | ðŸŸ¢ Complete (SKIP) | [eomsync.extraction.md](cobol-extractions/eomsync.extraction.md) | Outbox event `MONTH_END_COMPLETED` replaces sync call |
| reseteom.cbl | RESETEOM | CLI reset of ACSYS-TRACK-EOM=0 | SKIP | eom-service | ðŸŸ¢ Complete (SKIP) | [reseteom.extraction.md](cobol-extractions/reseteom.extraction.md) | `POST /:id/reset` with OPERATOR role + audit trail |
| yrend.cbl | YREND | Fiscal year-end close (zero P&L â†’ RE journal entry) | BUILD | eom-service | ðŸŸ¢ Complete + Tested | [yrend.extraction.md](cobol-extractions/yrend.extraction.md) | Pre-flight count; atomic TX; year-end preview; outbox event; `YearEndRecord` idempotency |
| caaccteoy.cbl | **CAACCTEOM** âš ï¸ | Year-end Java UI bridge â€” **PROGRAM-ID duplicate bug** | SKIP | eom-service | ðŸŸ¢ Complete (SKIP) | [caaccteoy.extraction.md](cobol-extractions/caaccteoy.extraction.md) | No naming collision in TypeScript |
| pushunposted.cbl | PUSHUNPOSTED | FileWatcher touch file for unposted batch import | SKIP | eom-service | ðŸŸ¢ Complete (SKIP) | [pushunposted.extraction.md](cobol-extractions/pushunposted.extraction.md) | Direct DB query replaces FileWatcher mechanism |
| clearunposted.cbl | CLEARUNPOSTED | ISAM exclusive-lock recovery for stuck batches | SKIP | eom-service | ðŸŸ¢ Complete (SKIP) | [clearunposted.extraction.md](cobol-extractions/clearunposted.extraction.md) | PostgreSQL MVCC + `journalBatch` lifecycle replaces spin-lock |

---

## Wave 3 â€” EOM Steps + Schedule Detail

| COBOL Program | PROGRAM-ID | Function | Decision | Target TS Service | Status | Extraction Doc | Intelligence Layer |
|---|---|---|---|---|---|---|---|
| glzero.cbl | GLZERO | Zero GL balances for year | BUILD | eom-service | ðŸ”´ Not Started | â€” | â€” |
| glzerosch.cbl | GLZERO | Zero GL schedules (dupe PGM-ID!) | BUILD | eom-service | ðŸ”´ Not Started | â€” | â€” |
| histtransync.cbl | HISTTRANSYNC | Sync histtran to Java/DOCMATE | ABSORB | gl-service (outbox events) | ðŸŸ¢ Absorbed | â€” | Event bus replaces sync call |
| eomrpt.cbl | EOMRPT | EOM report generation | BUILD | fs-service | ðŸ”´ Not Started | â€” | â€” |

---

## Wave 4 â€” Financial Statements

| COBOL Program | PROGRAM-ID | Function | Decision | Target TS Service | Status | Extraction Doc | Intelligence Layer |
|---|---|---|---|---|---|---|---|
| finstm01.cbl â€¦ finstm99.cbl | FINSTM01â€¦99 | Year-specific FS generation (max 2020) | **DO NOT BUILD** (config-driven replaces year-specific) | fs-service | ðŸŸ¢ Absorbed (config) | â€” | Single config-driven generator replaces 99 programs |
| finfmt.cbl | FINFMT | Format financial statement output | BUILD | fs-service | ðŸ”´ Not Started | â€” | â€” |
| finedt.cbl | FINEDT | Edit FS structure | BUILD | fs-service | ðŸ”´ Not Started | â€” | â€” |
| fssetup.cbl | FSSETUP | Configure FS mappings | BUILD | fs-service | ðŸ”´ Not Started | â€” | â€” |
| fscodes.cbl | FSCODES | Manage FS codes | BUILD | fs-service | ðŸ”´ Not Started | â€” | â€” |
| fsjava.cbl | FSJAVA | FS export to Java | ABSORB | fs-service (HTTP endpoint) | ðŸ”´ Not Started | â€” | REST API replaces file export |

---

## Wave 4 â€” Inquiry, Reports, Consolidation, 13th Month

| COBOL Program | PROGRAM-ID | Function | Decision | Target TS Service | Status | Extraction Doc | Intelligence Layer |
|---|---|---|---|---|---|---|---|
| inquiryn.cbl | INQUIRYN | GL Account + Schedule inquiry (5 type codes) | BUILD | gl-service | ðŸŸ¢ Complete + Tested | [inquiryn.extraction.md](cobol-extractions/inquiryn.extraction.md) | Aging bucket calc via date-fns; schedule security via SchedulePermission table; no ISAM sort file |
| inqtran.cbl | INQTRAN | Transaction history popup (source+refno) | BUILD | gl-service | ðŸŸ¢ Complete + Tested | [inqtran.extraction.md](cobol-extractions/inqtran.extraction.md) | Fallback "0"+refno preserved; voidck temp file eliminated |
| tranpr.cbl | TRANPR | Edit/print transaction journal (unposted batches) | BUILD | gl-service | ðŸŸ¢ Complete + Tested | [tranpr.extraction.md](cobol-extractions/tranpr.extraction.md) | 5000-entry GL table â†’ Prisma GROUP BY; 132-char print â†’ future report service |
| transumm.cbl | TRANSUMM | Autopost transaction summary report | BUILD | gl-service | ðŸŸ¢ Complete + Tested | [transumm.extraction.md](cobol-extractions/transumm.extraction.md) | Physical tran deletion â†’ `autopostSummarizedAt` soft-delete; COMPARE-ACCTS merge â†’ SQL LEFT JOIN |
| consolgl.cbl | CONSOLGL | Consolidated G/L menu (clear + import) | BUILD | group-service | ðŸŸ¢ Complete | [consolgl.extraction.md](cobol-extractions/consolgl.extraction.md) | opts2 config file â†’ ConsolidatedGlConfig table; Java OfficeMate syncs eliminated |
| consolexpgl.cbl | CONSOLEXPGL | Build merged GL/journal/source for consolidated company | BUILD | group-service | ðŸŸ¢ Complete | [consolexpgl.extraction.md](cobol-extractions/consolexpgl.extraction.md) | consolmap ISAM â†’ ConsolidationMapping Postgres; GLbyID rebuild eliminated; DB rebuild call eliminated |
| 13thmenu.cbl | 13THMENU | 13th Month accounting menu | BUILD | eom-service | ðŸŸ¢ Complete + Tested | [13thmenu.extraction.md](cobol-extractions/13thmenu.extraction.md) | Snapshot files eliminated; `periodMonth=13` filter; outbox `THIRTEENTH_MONTH_FINALIZED` event |
| addglto13th.cbl | ADDGLTO13TH | Copy new GL accounts to 13th month snapshot | **SKIP** (eliminated) | eom-service | ðŸŸ¢ Eliminated | [addglto13th-syncglsched13th.extraction.md](cobol-extractions/addglto13th-syncglsched13th.extraction.md) | No snapshot = no sync needed |
| syncglsched13th.cbl | SYNCGLSCHED13TH | Sync schedule records to 13th month snapshot | **SKIP** (eliminated) | eom-service | ðŸŸ¢ Eliminated | [addglto13th-syncglsched13th.extraction.md](cobol-extractions/addglto13th-syncglsched13th.extraction.md) | FK constraints replace snapshot sync |
| komgl.cbl | KOMGL | Batch GL account CRUD via line-sequential protocol | ABSORB | gl-service (Prisma) | ðŸŸ¢ Absorbed | [kom-crud-bulk.extraction.md](cobol-extractions/kom-crud-bulk.extraction.md) | `prisma.glAccount.upsert()` replaces KOM protocol |
| komglbyid.cbl | KOMGLBYID | Batch GL-by-ID CRUD | ABSORB | gl-service (Prisma) | ðŸŸ¢ Absorbed | [kom-crud-bulk.extraction.md](cobol-extractions/kom-crud-bulk.extraction.md) | Absorbed into GLAccount model |
| komtran.cbl | KOMTRAN | Batch transaction CRUD | ABSORB | gl-service (Prisma) | ðŸŸ¢ Absorbed | [kom-crud-bulk.extraction.md](cobol-extractions/kom-crud-bulk.extraction.md) | `prisma.journalEntry.create()` |
| komjrn.cbl | KOMJRN | Batch journal summary CRUD | ABSORB | gl-service (Prisma) | ðŸŸ¢ Absorbed | [kom-crud-bulk.extraction.md](cobol-extractions/kom-crud-bulk.extraction.md) | `prisma.gLAccountPeriodBalance.upsert()` |
| komsrc.cbl | KOMSRC | Batch source CRUD | ABSORB | gl-service (Prisma) | ðŸŸ¢ Absorbed | [kom-crud-bulk.extraction.md](cobol-extractions/kom-crud-bulk.extraction.md) | `prisma.journalSource.upsert()` |
| komsystem.cbl | KOMSYSTEM | Batch accounting system info CRUD | ABSORB | eom-service (Prisma) | ðŸŸ¢ Absorbed | [kom-crud-bulk.extraction.md](cobol-extractions/kom-crud-bulk.extraction.md) | `prisma.accountingSystem.update()` |

---

## Wave 5 â€” Schedules / AP / AR

| COBOL Program | PROGRAM-ID | Function | Decision | Target TS Service | Status | Extraction Doc | Intelligence Layer |
|---|---|---|---|---|---|---|---|
| schedinvk.cbl | SCHEDINVK | Schedule invoker | BUILD | gl-service | ðŸ”´ Not Started | â€” | â€” |
| schedpost.cbl | SCHEDPOST | Post scheduled items | BUILD | gl-service | ðŸ”´ Not Started | â€” | â€” |
| schedvw.cbl | SCHEDVW | View schedules (screen) | SKIP (screen) | gl-service | ðŸ”´ Not Started | â€” | â€” |
| clearunposted.cbl | CLEARUNPOSTED | Clear unposted items | BUILD | gl-service | ðŸ”´ Not Started | â€” | â€” |
| javsup.cbl | JAVSUP | Java support (AR/AP interface) | BUILD | apar-service | ðŸ”´ Not Started | â€” | â€” |
| jnlsrcsync.cbl | JNLSRCSYNC- | Journal source sync (malformed PGM-ID) | BUILD | gl-service | ðŸ”´ Not Started | â€” | â€” |

---

## DO NOT BUILD â€” Screens, Data Entry, Print Utilities

| COBOL Program | Reason |
|---|---|
| All `acct/scrn/*.dat` | Screen definitions â€” no screen layer in TS architecture |
| All `tranup*.cbl`, `srcup*.cbl`, `*vw.cbl` | Interactive screen programs |
| `print*.cbl`, `rpt*.cbl`, `*rpt.cbl` | Print utilities â€” replaced by React UI |
| `uucpfile.cbl` | Network config â€” replaced by Kubernetes networking |

---

## DO NOT BUILD â€” Data Repair Programs (COBOL OOB workarounds)

> These programs exist because COBOL had no transaction wrapper. All become unnecessary.

| COBOL Program | PROGRAM-ID | Reason Obsolete |
|---|---|---|
| fixoobtran.cbl | FIXOOBTRAN | Repairs JRN/HISTTRAN OOB â€” impossible with SERIALIZABLE TX |
| fixorphan.cbl | FIXORPHAN | Repairs orphaned tran records â€” impossible with atomic delete |
| dumpoobtran.cbl | DUMPOOBTRAN | Dumps OOB transactions for analysis â€” no OOB to dump |
| sniffbaddetailapplycd.cbl | SNIFFBADDETAILAPPLYCD | Detects bad apply codes â€” absorbed into Zod schema validation |
| fixglsort.cbl | FIXGLSORT | Fixes GL sort numbers â€” DB constraints prevent invalid sorts |

---

## DO NOT BUILD â€” Data Conversion / Migration Programs

| COBOL Program | Reason |
|---|---|
| All `cnv*.cbl` | Data conversion â€” one-time ETL handled by migration scripts |
| `filecrdf.cbl`, `filecr.cbl` | File creation â€” replaced by `prisma migrate` |
| `delimdgl.cbl`, `delimfil.cbl`, `delimhis.cbl`, `delimsch.cbl` | Archive/delete utilities â€” replaced by data retention policies |
| `deloldtran.cbl`, `deletetrn.cbl` | Batch delete â€” replaced by DB job or admin API |

---

## Year-End Special Handling (tranpost.cbl INV-04)

The `GLOBAL-YE-IS-IN-PROGRESS` flag (KEY-FROM-PROG = "Y") controls special year-end behavior in COBOL:
- Skip UPDATE-JOURNAL entirely
- Skip UPDATE-DETAIL entirely  
- Allow posting to inactive accounts
- Bypass cutoff date check
- Force autopost on reserved sources 09/88

TypeScript implementation: `isYearEnd: boolean` flag on JournalEntry (or as a context parameter on `approveJournalEntry`). This is passed through to all `postLineToLedger` helpers.

**Status:** ðŸ”´ Not Started â€” year-end transaction flow requires eom-service `GLOBAL-YE-IS-IN-PROGRESS` equivalent event.

---

## Known COBOL Bugs Documented (not reproduced in TypeScript)

| Bug | COBOL File | Maint Ticket | TypeScript Disposition |
|---|---|---|---|
| DUPEREFNO overflows at 99 â†’ infinite loop | tranpost.cbl | MAINT-15701 | Impossible: DB has no DUPEREFNO overflow limit |
| Histtran boundary violation (file full) | tranpost.cbl | MAINT-15851 | Impossible: PostgreSQL has no fixed-size file limit |
| JRN balance > 999,999,999.99 â†’ zeroed | tranpost.cbl | (implicit) | Decimal(15,2) handles 9,999,999,999,999.99 |
| OOB from interrupted post | tranpost.cbl | AMMAINT-34350 et al. | Impossible: SERIALIZABLE TX |
| Duplicate PROGRAM-ID GLZERO | glzero.cbl / glzerosch.cbl | â€” | Both mapped to separate TS functions |
| Duplicate PROGRAM-ID CAACCTEOM | caaccteom.cbl / caaccteoy.cbl | â€” | Separate TS functions |
| Self-referential CALL in getacctfn.cbl | getacctfn.cbl | â€” | Not reproduced â€” absorbed into accountRepo |
| Self-referential CALL in getreservedjs.cbl | getreservedjs.cbl | â€” | Not reproduced |
| Trailing dash in JNLSRCSYNC-.cbl | jnlsrcsync.cbl | â€” | Absorbed into outbox event bus |

---

## Wave 5 — Stabilization Sprint (No COBOL)

> No new COBOL programs read. Wave 5 was a cleanup sprint: mock data eliminated, secrets
> enforced, in-memory stores replaced with Prisma, 4 empty shells archived.

| Area | Component | Change | Status |
|------|-----------|--------|--------|
| Security | scripts/aws-key.pem, cloudflared.exe, macc_mock_api.py | Deleted from repo | 🟢 Complete |
| Security | .gitignore | Added *.pem, *.key, cloudflared*, *.exe | 🟢 Complete |
| JWT | auth-service, webhook-service, tenant-service, cashflow-service | Fail-fast if AMACC_JWT_SECRET missing | 🟢 Complete |
| Developer routes | auth-service | Gated by NODE_ENV === 'development' | 🟢 Complete |
| Mock data | analytics-service | Removed MOCK_PL, MOCK_TECH, MOCK_PARTS | 🟢 Complete |
| Mock data | compliance-service | Removed mockAlerts(), DEFAULT_RULES | 🟢 Complete |
| Mock data | cashflow-service | Removed hardcoded currentCash = 287500 | 🟢 Complete |
| In-memory store | orchestrator-service | Replaced unningTasks = new Map() with Prisma OrchestrationTask | 🟢 Complete |
| Tenant fallbacks | analytics, compliance, cashflow, orchestrator, query | Removed \|\| 'tenant-kunes' → 401 | 🟢 Complete |
| Archive | esg-service, revenue-service, ml-service, data-quality-service | Moved to rchived-services/ with rationale | 🟢 Complete |
| api-gateway | nginx → Fastify | @fastify/http-proxy reverse proxy, 24-service registry | 🟢 Complete |
| Notification | notification-service | Wired 7 Wave 1-4 events | 🟢 Complete |
| Docker Compose | docker-compose.yml | Secrets required, archived services removed, schedule-service added | 🟢 Complete |
| Shared kernel | events/index.ts | Added 8 Wave 1-4 event types + routing | 🟢 Complete |

---

## Wave 6 — Intelligence Layer Activation

> All 5 AI agent services activated. No new COBOL reads. COBOL had **zero** AI/advisory
> capabilities. This wave is entirely net-new capability.

| Agent | Service | Subscribes To | Produces | Status |
|-------|---------|---------------|----------|--------|
| GL Integrity Agent | agent-gl | JOURNAL_ENTRY_SUBMITTED, JOURNAL_ENTRY_POSTED | AGENT_HUMAN_REQUIRED, AGENT_ACTION_TAKEN | 🟢 Complete + Tested |
| EOM Orchestration Agent | agent-eom | EOM_STEP_CHANGED, EOM_CLOSE_COMPLETED, YEAR_END_COMPLETED | AGENT_HUMAN_REQUIRED, AGENT_ACTION_TAKEN | 🟢 Complete + Tested |
| AP/AR Intelligence Agent | agent-apar | OEM_REMITTANCE_IMPORTED, BANK_RECON_STARTED | AGENT_HUMAN_REQUIRED, AGENT_ACTION_TAKEN | 🟢 Complete |
| Payroll Integrity Agent | agent-payroll | PAYROLL_BATCH_SUBMITTED | AGENT_HUMAN_REQUIRED, AGENT_ACTION_TAKEN | 🟢 Complete |
| T1 Copilot | agent-t1 | HTTP POST /api/v1/copilot/t1/chat (SSE) | Streaming natural language responses | 🟢 Complete + Tested |

### Agent Domain Checks (not in COBOL)

| Agent | Check | COBOL Equivalent |
|-------|-------|-----------------|
| agent-gl | Debit to revenue account | ❌ None |
| agent-gl | Amount >2x 90-day average | ❌ None |
| agent-gl | Cross-module contamination (SERVICE_EOD + PARTS_EOD in same entry) | ❌ None |
| agent-gl | Missing tech attribution on SERVICE_RO | ❌ None (discovered at month-end) |
| agent-gl | Parts margin < 0 (COS > revenue) | ❌ None |
| agent-eom | Unposted transactions blocking close | ❌ Manual check only |
| agent-eom | Step 068 without tech attribution | ❌ None |
| agent-eom | Step 077 with < 90% dept codes | ❌ None |
| agent-eom | Step failure root cause diagnostic | ❌ None |
| agent-apar | OEM warranty labor rate mismatch | ❌ None |
| agent-apar | Warranty part claimed but not on RO | ❌ None (fraud risk undetected) |
| agent-payroll | Double-posting detection (idempotency key) | ❌ None |
| agent-payroll | Per-employee >50% pay variance | ❌ None |
| agent-payroll | Unmapped earning codes | ❌ None |
| agent-payroll | Tech hours vs payroll hours cross-check | ❌ None |

### Infrastructure (Wave 6)

| Component | Change | Status |
|-----------|--------|--------|
| gent-gl/src/index.ts | Fail-fast ANTHROPIC_API_KEY | 🟢 Complete |
| gent-eom/src/index.ts | Fail-fast ANTHROPIC_API_KEY | 🟢 Complete |
| gent-apar/src/index.ts | Fail-fast ANTHROPIC_API_KEY | 🟢 Complete |
| gent-payroll/src/index.ts | Fail-fast ANTHROPIC_API_KEY | 🟢 Complete |
| gent-t1/src/index.ts | Fail-fast ANTHROPIC_API_KEY | 🟢 Complete |
| gent-t1/src/http/routes.ts | Removed demo-mode fallback, added tenant 401 check | 🟢 Complete |
| gl-service/src/application/agent-timeout.ts | Auto-approve timeout job (default 30s) | 🟢 Complete |
| gl-service/src/index.ts | Wires AgentReviewTimeoutJob, polls every 10s | 🟢 Complete |
| pi-gateway/src/index.ts | Added /api/v1/copilot → agent-t1 proxy entry | 🟢 Complete |
| docker-compose.yml | Agent services get ANTHROPIC_API_KEY:?required + service URLs | 🟢 Complete |
| docs/ARCHITECTURE.md | Definitive reference document | 🟢 Complete |