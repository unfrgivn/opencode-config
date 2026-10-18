---
description: Run a parallel subagent delegation torture test audit
---
Run a parallel delegated repo audit and keep work in background while staying interactive.

Create separate subagent tasks (do not serialize) for each track below, then return one consolidated report with sections A-F plus a final risk matrix.

A) Asset Inventory
- Enumerate bundled assets under skill/, agent/, command/, instruction/, and mcp/, plus compiled runtime plugins under src/.
- Report counts, naming anomalies, and any files that violate expected folder/file conventions.

B) Manifest Integrity
- Validate instruction files against manifest.json entries.
- Report missing, extra, or duplicated instruction paths.
- Flag any path casing mismatches.

C) Config and Schema Consistency
- Inspect src/config.ts and related usage.
- List supported fellowship.json fields, defaults, and any dead/unused config keys.
- Note any mismatch between docs and runtime behavior.

D) Load Pipeline Trace
- Trace end-to-end flow across src/index.ts, src/assets.ts, src/install.ts, src/disable.ts, src/mcp-install.ts.
- Produce a step-by-step execution map with key decision points and failure modes.
- Identify where parallelism/concurrency exists and where it is effectively serialized.

E) Test Coverage Gaps
- Inspect src/*.test.ts and map tests to major behaviors.
- Identify high-risk untested paths (prioritized top 10).
- Suggest specific test cases with file targets.

F) Orchestration Runtime Readiness
- Inspect orchestration-related instructions/config references in repo docs/instructions.
- Evaluate whether this repo's guidance is sufficient to operate /continue, /stop, /tasks, /task, /diagnostics reliably.
- List concrete doc improvements.

Output requirements:
1) Start with a one-screen executive summary.
2) Then provide sections A-F with evidence bullets and file references.
3) Include a final table: Issue, Severity, Confidence, Suggested Fix.
4) Include "Parallelism Evidence" listing task IDs, start/end times, and overlap windows proving concurrent execution.
5) If any track fails, continue others and report partial results clearly.
