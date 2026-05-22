# Legacy Workflow Analysis Playbook

This playbook standardizes how training videos are converted into implementation-ready requirements for AutoMate 2.0 and AMACC inside the AM-Accounting workspace.

## Objective

For each uploaded training video:

1. Identify the workflow being demonstrated.
2. Map each screen and action to likely legacy assets.
3. Trace cross-module dependencies across COBOL, Java, shared screen definitions, and accounting.
4. Convert the legacy workflow into AMACC and AutoMate 2.0 modernization requirements.
5. Record rebuild notes that improve the workflow rather than copying legacy UX.

## Source Trees Available

### Current AM-Accounting Workspace

- AMACC web app and services: `<workspace>/amacc`
- Existing accounting COBOL assets in this repo: `<workspace>/acct`

### Adjacent Legacy and Java Source Trees

These paths were verified on disk and should be used for cross-referencing training videos:

- COBOL Parts module: `/Users/shivashankarangadi/Public/Projects/Requirements Engine/Part`
- COBOL Accounting module: `/Users/shivashankarangadi/Public/Projects/Requirements Engine/acct`
- COBOL database/shared support: `/Users/shivashankarangadi/Public/Projects/Requirements Engine/amdb`
- COBOL AP/financial support: `/Users/shivashankarangadi/Public/Projects/Requirements Engine/apay`
- AMPS Java applications root: `/Users/shivashankarangadi/Public/Projects/Requirements Engine/AMPS`
- AMService Java services: `/Users/shivashankarangadi/Public/Projects/Requirements Engine/AMService`
- Accounting Java services: `/Users/shivashankarangadi/Public/Projects/Requirements Engine/Accounting`
- Service specifications: `/Users/shivashankarangadi/Public/Projects/Requirements Engine/service-specifications`

### High-Value Java Modules Already Located

- Appointments: `/Users/shivashankarangadi/Public/Projects/Requirements Engine/AMPS/appoint`
- Parts: `/Users/shivashankarangadi/Public/Projects/Requirements Engine/AMPS/amparts`
- Service: `/Users/shivashankarangadi/Public/Projects/Requirements Engine/AMPS/caserv`
- Service pricing: `/Users/shivashankarangadi/Public/Projects/Requirements Engine/AMPS/servicepricing`

### Legacy UI / Screen Assets Already Located

- Parts screens: `/Users/shivashankarangadi/Public/Projects/Requirements Engine/Part/scrn`
- Accounting screens: `/Users/shivashankarangadi/Public/Projects/Requirements Engine/acct/scrn`
- AMDB screens: `/Users/shivashankarangadi/Public/Projects/Requirements Engine/amdb/scrn`
- APAY screens: `/Users/shivashankarangadi/Public/Projects/Requirements Engine/apay/scrn`

## Proven Analysis Method

### Step 1: Video Inventory

For each uploaded video, capture:

- Workflow name
- Business area: Parts, Service, Fixed-Ops, Accounting, Cross-Module
- User persona performing the task
- Start screen and end state
- Every visible screen transition
- Every entered value, popup, warning, and printed output

Save screenshots for every distinct screen state, not just page changes.

### Step 2: Screen-to-Legacy Mapping

After the screen sequence is documented, map each screen to likely legacy assets using this priority order:

1. ScreenGen and screen files in `scrn/`
2. COBOL programs in `src/`, `prog/`, `specprog/`, or related folders
3. COPY/DAT/shared structures in `copy/`, `speccopy/`, `.ws`, `.fd`, `.fc`, `.fn`, `.dclr`
4. Java SWT or plugin classes in AMPS and AMService
5. Current AMACC service or frontend surfaces that must receive the rebuilt behavior

### Step 3: Code Correlation Rules

Use these heuristics when correlating video evidence to code:

- If the screen title, field labels, or popup names look legacy, search the corresponding `scrn/` directory first.
- If the video shows Parts inventory, supersession, pricing, receipts, SOR, or special orders, search `Part/` and `AMPS/amparts/`.
- If the video shows appointments, advisor scheduling, technician load, route sheet, or service pricing, search `AMPS/appoint/`, `AMPS/caserv/`, and `AMPS/servicepricing/`.
- If the workflow posts, reconciles, closes periods, or updates GL impact, search `acct/`, `Accounting/`, and AMACC service endpoints.
- If the workflow crosses modules, identify the system of record at each step and record the handoff explicitly.

### Step 4: Rebuild Framing

Do not translate the workflow as a UI copy exercise. Each video review must answer:

- What business outcome is the user trying to achieve?
- Which steps are pure legacy navigation overhead?
- Which validations are essential business logic versus accidental UI friction?
- Which calculations belong in a service layer rather than a screen?
- Which steps should become defaults, automation, or AI-assisted suggestions?
- Which module should own the workflow in AutoMate 2.0 versus AMACC?

## Mandatory Output Structure

For every workflow analysis, produce all sections below.

### 1. Workflow Identification

- Workflow name
- Module
- User role
- Business purpose
- Estimated COBOL programs involved
- Estimated Java classes involved

### 2. Screen-by-Screen Sequence

| Screen # | Timestamp | Screen Name | Key Fields Visible | Actions Taken | Data Entered | Navigation |
| --- | --- | --- | --- | --- | --- | --- |

### 3. Business Rules Observed

- Required fields and blockers
- Calculations and formulas
- Conditional logic and branching
- Status transitions
- Permission gates and overrides
- Cross-module rules

### 4. Data Entities Touched

| Entity | Operation | Key Fields | Relationships | Likely COBOL File or Table | Likely Java Class |
| --- | --- | --- | --- | --- | --- |

### 5. Integration Points

- OEM integrations
- Service links
- Accounting and GL links
- Print, email, SMS, or messaging
- Multi-store or multi-company sharing

### 6. UI Patterns

- Layout model
- Navigation model
- Grid and table behavior
- Action placement
- Legacy pain points

### 7. Edge Cases and Warnings

- Errors
- Warnings
- Confirmation dialogs
- Exceptional flows

### 8. Workflow Diagram

Represent the flow as:

`START -> [Screen/Action] -> <Decision?> -> [Branch A or B] -> END`

### 9. Cross-Module Dependencies

| Touchpoint | Source Module | Target Module | Data Exchanged | Direction |
| --- | --- | --- | --- | --- |

### 10. AutoMate 2.0 Rebuild Notes

- What is broken or costly in the legacy workflow
- What should be redesigned instead of reproduced
- What modern UX pattern should replace it
- What can be automated or AI-assisted
- What belongs in AMACC versus another module

## AMACC-Specific Translation Layer

When a video touches accounting or downstream financial effects, extend the analysis with these AMACC checks:

1. Determine whether the workflow creates a posting event, approval event, receivable, payable, inventory change, or period-close dependency.
2. Identify which AMACC service should own the modern implementation.
3. Record whether the legacy workflow is synchronous, batched, or end-of-day in nature.
4. Separate operational source data from accounting projections and journal outcomes.
5. Note any tenant, rooftop, or franchise-specific branching that must become configuration.

Candidate AMACC ownership areas include:

- GL and journal flow
- Accounts payable and cash receipts
- approvals
- reconciliation
- financial statement rollups
- year-end and EOM close
- analytics and anomaly detection

## High-Value Java Starting Points

When the workflow is service-appointment related, start with these known classes in the verified Java tree:

- `com.automate.appoint.Appoint`
- `com.automate.appoint.AppointComposite`
- `com.automate.serv.appointments.AddEditAppointmentComposite`
- `com.automate.serv.appointments.AdvisorDayView`
- `com.automate.serv.appointments.AdvisorWeekView`
- `com.automate.serv.appointments.CalViewComposite`
- `com.automate.serv.appointments.MonthView`
- `com.automate.appoint.tablet.TabletAddEditAppointment`
- `com.automate.appoint.tablet.TabletAppointmentView`

When the workflow is parts related, begin in:

- `AMPS/amparts/src/com/automate/part/`
- `Part/scrn/`
- `Part/src/`
- `Part/copy/`

When the workflow is accounting related, begin in:

- `acct/src/`
- `acct/copy/`
- `Accounting/`
- `amacc/apps/web/src/pages/`
- `amacc/services/`

## Intake Checklist For Every New Video

Before starting analysis, confirm:

1. Video filename and business area
2. Whether the workflow is current-state or target-state
3. Whether the expected output is Parts, Service, AMACC, or cross-module
4. Whether a matching screenshot set should be saved separately
5. Whether the review should end at legacy mapping or continue into AMACC redesign

## Missing or External Trees

The user referenced a `vs-am-cobol` directory, but that path is not currently available in the active workspace or the adjacent project paths that were inspected. If that tree is required for full traceability, add it to the workspace or provide its absolute path and fold it into this playbook as an additional legacy source root.

## Recommended Execution Pattern

For each future video:

1. Extract the workflow evidence from the video itself.
2. Match the screen evidence to screen files and legacy programs.
3. Trace Java helpers, plugins, and services.
4. Identify accounting impact and AMACC ownership.
5. Produce modernization notes aimed at production readiness, not legacy fidelity.
6. Convert the result into implementation tasks for AutoMate 2.0 and AMACC.