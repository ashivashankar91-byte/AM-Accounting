# COBOL Extraction: KOM CRUD Programs (Bulk Reference)

**Programs**: komgl.cbl, komglbyid.cbl, komtran.cbl, komjrn.cbl, komsrc.cbl, komsystem.cbl  
**Author**: Robert Stelman  
**Pattern**: All follow identical architecture (KOM CRUD framework)

---

## Architecture Overview

KOM programs are **data access layer** programs. They receive a line-sequential input file specifying CRUD operations on COBOL ISAM files, execute them, and write results to a line-sequential output file.

**No business logic** — pure read/write/delete/insert against indexed COBOL files.

Called by: Java OfficeMate services (via shell/system call), other COBOL programs needing cross-module data access.

---

## Input Protocol (line-sequential file)

```
Line 1: response-filename (writeback path)
Line 2: version ("1")
Line 3: module-name
Line 4: company-number (2 digits)
Line 5: on-fail action ("DIE" | "CONTINUE")
[Repeat for each transaction:]
  Line N:   transaction-ID (echoed back in response)
  Line N+1: action ("UPDATE" | "DELETE" | "INSERT" | "REPLACEORINSERT" | "REPLACE")
  Line N+2: primary key
  [field lines for UPDATE/INSERT...]
```

## Response Protocol

```
" START: {transaction-ID}"
[For success:]   " 00000: {key}"
[For error:]     "E{code}: {message}"
```

---

## Programs and Their Target Files

| Program | Target File | Primary Key | Actions |
|---------|------------|------------|---------|
| `komgl.cbl` | `gl` (GL accounts) | `GL-ACCTNO` | UPDATE, REPLACE, DELETE, INSERT, REPLACEORINSERT |
| `komglbyid.cbl` | `glbyid` (GL ID mapping) | `GBI-ACCTNO` | UPDATE, DELETE, INSERT, REPLACEORINSERT |
| `komtran.cbl` | `tran` (unposted transactions) | `TR-SOURCE + TR-DATE + TR-SEQNO` | UPDATE, DELETE, INSERT, REPLACEORINSERT |
| `komjrn.cbl` | `jrn` (journal summaries) | `JR-ACCTNO + JR-YEAR-MONTH + JR-SOURCE` | UPDATE, DELETE, INSERT, REPLACEORINSERT |
| `komsrc.cbl` | `src` (journal sources) | `SR-SOURCE` | UPDATE, DELETE, INSERT, REPLACEORINSERT |
| `komsystem.cbl` | `sys` (accounting system info) | `ACSYS-KEY` | UPDATE, INSERT, REPLACEORINSERT (no DELETE) |

---

## Record Locking

All KOM programs implement retry-on-lock:
```
MAX-TRIES = 10
sleep .1 between retries
On exceeded: "L{code} Ask {userId} to close screen on account #: {key}"
```

---

## TypeScript Verdict: **FULLY REPLACED BY PRISMA**

Each KOM program maps directly to Prisma model operations:

| KOM | Prisma Equivalent |
|-----|-------------------|
| komgl UPDATE/INSERT | `prisma.glAccount.upsert()` |
| komgl DELETE | `prisma.glAccount.delete()` |
| komtran INSERT | `prisma.glTransaction.create()` |
| komjrn UPDATE | `prisma.journalSummary.upsert()` |
| komsrc INSERT | `prisma.journalSource.upsert()` |
| komsystem UPDATE | `prisma.accountingSystem.update()` |

Record locking → handled by Postgres row-level locking via Prisma transactions (`$transaction` with `SELECT ... FOR UPDATE`).

No TypeScript code needs to be written for any KOM program. They have no direct API endpoint equivalents.

---

## KOM Callers in TypeScript Context

Java services that call KOM programs → replaced by TypeScript services calling Prisma directly. The KOM programs are an intermediate layer that becomes unnecessary when moving to a Postgres-native stack.

The pattern `runcobol85 ../../acct/prog/komgl K A="{input}"` → direct `prisma.glAccount.upsert(...)`.
