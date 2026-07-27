# AutoMate Accounting — Golden R0 Claude Design Export

## Purpose

This folder contains the exported Claude Design reference for Golden R0 Accounting UX convergence.

## Files

- `AutoMate_Accounting_Golden_R0_Design.html` — complete design document containing sections 00–09, handoff, decisions, and readiness.
- `ReportScreen.html` — shared report-screen design component used by GL Search, GL Inquiry, Trial Balance, Balance Sheet, and Income Statement.
- `support.js` — Claude Design runtime required to render the exported HTML files.
- `uploads/visual-reference-solera.png` — supplied Solera visual-language reference.
- `uploads/current-accounting-reference.png` — supplied current Accounting implementation reference.

## Design precedence

1. Accepted Story Contract and approved business rules
2. Certified backend/API behavior
3. This exported Claude Design package
4. Current frontend implementation

The exported HTML is an interactive UX reference, not production React code. Implement using the existing application shell, React conventions, real gateway APIs, authorization, tenant isolation, and audit controls.

## Included UX sections

- 00 — Read Me and Status
- 01 — Visual Foundations
- 02 — Component Library
- 03 — Navigation and Accounting Shell
- 04 — Journal Entry
- 05 — GL Search
- 06 — GL Inquiry
- 07 — Trial Balance
- 08 — Balance Sheet
- 09 — Income Statement
- Handoff
- Decisions
- Readiness

## Important implementation notes

- The five reporting screens use one shared `ReportScreen` design component and common shell/context/filter/table/export/drawer patterns.
- The design currently contains `API_CONFIRMATION_REQUIRED`, Product, and SME flags. Resolve them against repository evidence before production implementation.
- Comparative columns, YTD, percent-of-revenue, export formats, and some drill-down details must not ship unless supported by the certified contracts.
- The current frontend screens are implementation evidence, not the visual source of truth.
- Do not paste generated HTML directly into the production React application.

## Recommended repository location

`docs/accounting-modernization/ux/golden-r0/claude-design/`
