# AM-Accounting

AM-Accounting is the accounting-focused workspace for AutoMate 2.0.

This repository now serves as the umbrella workspace for the Automotive Accounting Cloud Platform, with AMACC as the active product implementation and the local accounting COBOL assets retained for legacy traceability and workflow validation.

## Platform Overview

AMACC stands for Automotive Accounting Cloud Platform.

It is a modern, cloud-native, AI-powered accounting system replacing a 30-year-old COBOL accounting stack used by auto dealerships.

### What It Does

- Processes dealership accounting activity at rooftop scale
- Covers General Ledger, AP/AR, Payroll, Bank Reconciliation, Month-End Close, and OEM Financial Statements
- Uses AI agents to validate and assist financial workflows
- Supports roles such as CFO, Controller, Accounting Manager, and Service Manager

### Core Stack

- Frontend: React 18, TypeScript, Vite
- Backend: Node.js microservices with Fastify
- Data: PostgreSQL with Prisma ORM
- Messaging: RabbitMQ
- AI: Anthropic Claude-powered agents
- Containerization: Docker Compose

## Workspace Layout

- `amacc/` — active AMACC product codebase
- `acct/` — local legacy accounting COBOL assets for archaeology and workflow verification
- `automate2-accounting-brd.md` — business requirements
- `automate2-accounting-prd.md` — product requirements
- `automate2-accounting-user-stories.json` — accounting user stories
- `amacc/docs/` — architecture, extraction, gap analysis, and workflow-analysis playbooks

## Current Positioning

- Jira and Confluence export tooling has been removed from this workspace
- The repository is now accounting-only in purpose and documentation
- Video analysis is treated as workflow validation against real dealer behavior, not just legacy contracts

## Important Note

The AMACC application code is still physically located under `amacc/` in this workspace. That preserves the active in-progress development tree safely while the repository is being reoriented around AM-Accounting.

If a later cleanup is desired, the next step would be a controlled flattening of `amacc/` into the repository root after the existing in-progress service changes are stabilized.
