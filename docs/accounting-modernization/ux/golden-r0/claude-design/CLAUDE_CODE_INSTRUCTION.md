# Claude Code instruction

Read this folder completely before changing Golden R0 frontend code.

Use this precedence:

1. Accepted Story Contract
2. Certified backend/API behavior
3. Exported Claude Design artifacts in this folder
4. Existing frontend implementation

First return a design-to-code comparison for Journal Entry, GL Search, GL Inquiry, Trial Balance, Balance Sheet, and Income Statement. For each screen identify the existing route/component, real API mapping, reusable components, visual gaps, interaction gaps, missing states, unsupported proposals, and exact implementation sequence.

Do not copy the generated HTML directly. Rebuild the approved experience using the current React application and shared components.

Resolve confirmed integration defects before visual convergence, including any broken Trial Balance-to-GL-Inquiry preset/API mapping and routed screens that still call legacy endpoints.

Implement one screen at a time with TypeScript, production build, real gateway integration, authorization/tenant checks, audit evidence, and Playwright assertions.
