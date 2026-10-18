---
name: write-ticket
description: Draft and create Jira tickets with an interactive walkthrough that refines acceptance criteria, fills metadata, and previews before submission. Use this whenever the user wants to write a ticket, create a story, file a bug, or plan work in Jira — even if they just say "let's write a ticket" or "I need to create a story for X."
---
# Write Ticket

Interactive ticket-writing assistant. Walks the user through drafting a well-structured Jira ticket with refined acceptance criteria, then creates it via the Atlassian API.

## Workflow

### 1. Resolve project key

Resolve the project key with the `resolve-project-key` skill. Use explicit user input, a mapping documented in the repository's `AGENTS.md`, or a Jira key prefix in the branch name. If it remains unresolved, ask the user with the `question` tool. Never guess a default project.

Resolve the issue type and field mappings for the selected Jira site. Story points, sprint, team/squad, and other custom field IDs differ between Jira sites. Use `fetch-jira-field-options` or Jira/acli create metadata for the selected project and issue type, and skip a field when it is not present.

Use `Medium` and `None / skip` as neutral choices only where those values are valid for the selected site's metadata.

### 2. Gather core info and issue type

Default new tickets to **Story** unless the user explicitly asks for another type or the context clearly requires a Bug or Spike.

Use staged prompts so early answers produce better dynamic options later. Do **not** ask every Jira metadata question before you know the project, issue type, and what kind of content the user has.

#### Stage 1 — Intake

The first `question` tool call should collect only the intake fields needed to draft the ticket and decide what metadata to fetch:

```
Question 1 — Project? → Project key from context, Custom project
Question 2 — Issue type? → Story (Recommended), Bug, Spike
Question 3 — Title / summary? → Use the title I provided, I need help drafting it
Question 4 — Acceptance criteria status? → Draft ACs from my context (Recommended), I already provided ACs, I need help deciding ACs
Question 5 — What are you bringing to this ticket? →
  "Background / context" — I know the problem, help me write the ticket
  "Acceptance criteria" — I already have ACs drafted
  "Implementation details" — I know the technical approach
  "All of the above" — I have everything, just need it formatted
  "Just a title" — Help me figure out the rest
```

Only include intake questions that are not already answered by the user's prompt. If the user did not provide a title or enough context to draft ACs, use the custom answer path or ask one concise follow-up after this intake prompt.

#### Stage 2 — Acceptance criteria review

If the user did not supply final ACs, draft them after Stage 1 and ask the user to check them before metadata collection. This keeps metadata suggestions tied to a real ticket, not vibes. Use the acceptance-criteria review guidance in step 3.

If the user already supplied final ACs, skip the AC review prompt unless they are ambiguous, untestable, or incomplete.

#### Stage 3 — Dynamic metadata

After project, issue type, title/context, and AC direction are clear, fetch targeted dynamic options for the remaining metadata questions. Then ask one `question` tool call with one question per field:

```
Question 1 — Squad / Team? → values from `fetch-jira-field-options` for `customfield_20001`, None/Skip, Custom
Question 2 — Component? → suggested component(s), None/Skip, Custom
Question 3 — Feature? → suggested feature(s), None/Skip, Custom
Question 4 — Labels? → suggested labels with multiple: true, None (Recommended), Custom
Question 5 — Sprint? → active/current sprint, next real sprint, Backlog / no sprint (Recommended), Custom sprint id
Question 6 — Story points? → 1 (Recommended), 2, 3, 5, 8, Skip
Question 7 — Priority? → Medium (Recommended), Low, High, Highest
Question 8 — Assign to me after creation? → No (Recommended), Yes
```

For Bugs, skip Story points. For non-the selected project or non-Story flows, adjust the metadata fields to the selected issue type. Do not combine multiple Jira fields into one option.

**Why ask issue type first:** The issue type determines which metadata fields to collect (e.g. Stories get story points, Bugs don't). Asking it before metadata lookup makes the later options better.

Use the `question` tool for ticket-writing decisions instead of open-ended prose whenever there are concrete options. Include the recommendation in the option label, e.g. `Story (Recommended)`, and keep a custom answer path available when the user may need it.

Based on their "what are you bringing" answer, collect what they have conversationally. If they chose:

- **Background** — ask them to describe the problem and motivation. You'll draft ACs and implementation details.
- **Acceptance criteria** — ask them to share their ACs. You'll review/refine them and ask about background.
- **Implementation details** — ask them to describe the technical approach. You'll draft ACs from that and ask about background.
- **All of the above** — let them dump everything. Extract and organize it.
- **Just a title** — ask clarifying questions to understand the problem, then draft everything.

If the user dumps a wall of context at any point, extract what you need from it rather than asking them to restate everything.

### 3. Draft and refine ticket content

Based on what the user provided in step 2, fill in the gaps. Use the `question` tool for decisions that affect the ticket, especially when acceptance criteria are ambiguous, the scope could be split, or there are multiple reasonable behaviors.

**Acceptance criteria** — the most important part. Good ACs are testable, specific, and complete.

- If the user provided ACs: Review and suggest improvements. Are they testable? Complete? Specific?
- If the user provided background or implementation details but no ACs: Draft 3-6 ACs. For Stories, use table row format:
  ```
  | Given [context], when [action], then [expected result] | |
  | [Specific, verifiable statement about behavior] | |
  ```
- Present your draft and ask with the `question` tool: **"How do these acceptance criteria look?"** Use options such as "Looks good (Recommended)", "Add a case", "Remove a case", "Change wording", and let the user type a custom answer.
- Iterate until the user is satisfied. This back-and-forth is the core value of the skill — don't rush it.

**Background** — if not yet provided, ask for it or infer from the ACs/implementation details.

**Implementation details** — if not yet provided, include any technical guidance you can infer. This is optional — skip if there's nothing useful to add.

Examples of decisions to ask via `question` tool:

- Whether this should be one ticket or split into multiple tickets.
- Which user-facing behavior should happen when requirements are unclear.
- Whether inferred acceptance criteria are correct or missing important edge cases.
- Whether optional implementation details belong in the ticket or should stay out.

### 4. Collect metadata via question tool

Use the `question` tool deterministically for missing metadata. Do **not** combine multiple Jira fields into one option like "a project-approved component + Sprint 209 + 1 point". Each Jira field gets its own question so the user's choices map cleanly into `ticket-spec.json`.

Prefer **one** metadata `question` tool call containing multiple separate questions after intake and AC review. If the option lists are too long, split into multiple calls, but keep each question about exactly one field. Skip fields the user already provided or clearly stated in prose. Every specific field choice should be prompted through the `question` tool with recommended/default choices clearly marked.

#### Deterministic metadata question order

Ask missing fields in this order, using one question per field:

1. **Squad / Team** — "Which squad/team owns this?" if the field exists. For the selected project, fetch allowed values from `customfield_20001` with the `fetch-jira-field-options` skill. Use actual squad values only, not components or products. If the helper returns only `None / skip` and `Custom`, treat that as a failed lookup, not a valid options list.
2. **Component** — "Which component should this ticket use?"
3. **Feature** — "Which feature should this ticket use?" if the field exists
4. **Labels** — "Which labels should be applied?" with `multiple: true`
5. **Sprint** — "Which sprint should this go in?"
6. **Story points** — "How many story points?" for Stories only
7. **Priority** — "What priority?"
8. **Assign to me?** — "Assign this ticket to you after creation?"

Use the user's answers verbatim when writing the canonical spec. If the user chose `1` story point, `ticket-spec.json` must include `"storyPoints": 1`. If they chose a sprint, it must include the sprint id in `"sprint"`. If they chose component, squad/team, labels, or priority, those choices must appear in the appropriate canonical spec fields or `additionalFields` before generation.

**Ordering rule for long lists (Feature, Component):** Put up to 3 recommended options first (marked with "(Recommended)"), then list remaining options in alphabetical order.

#### Site-specific field mappings

- Discover story point, sprint, team/squad, feature, and other custom field IDs for the selected project and issue type before asking about them.
- Use one targeted lookup for each missing field. Do not invent IDs or option IDs.
- If a requested field is absent or cannot be resolved, skip it and explain why rather than guessing.

#### Team / squad and sprint options

Team/squad is not the same as component. When the selected issue type exposes a team or squad field, fetch its exact field key and allowed values with `fetch-jira-field-options` before asking. Do not substitute components, products, labels, or inferred technology names.

Sprint values are site-specific. When sprint is available, search the selected project's scrum boards and list active/future sprints. Use the returned board and sprint IDs, ignore placeholders unless requested, and offer `Backlog / no sprint` only when that value is supported. If metadata is unavailable, skip the field or ask for an explicitly supplied ID.


#### Auto-inferred fields (do not ask — set automatically only when confident):

- **Technology** — Infer from the ticket content **only when there is an explicit technology signal** (e.g. the ticket mentions Django views, Python code, React components, SQL queries, etc.). If the ticket content does not clearly indicate a specific technology, **omit this field entirely** — do not guess.
- **Depth Needed / Complexity** — Infer the expertise level required. Consider: Is this a straightforward CRUD change (low)? Does it require understanding a specific subsystem (medium)? Does it require deep domain expertise or architectural changes (high)? Use the project's field mapping if available; otherwise omit.
- **Story Type / Work Type** — Default to the team's standard (often Enhancement) unless the ticket is clearly a chore/maintenance task. Only set if the field exists for this issue type.

#### Field prompts (adjust options to your Jira schema)

Ask only the fields that exist for the selected issue type:

- **Component** — single-select from Jira components
- **Priority** — select from Jira priorities
- **Assign to me?** — Yes/No (Recommended)
- **Story points** — if Story and field exists
- **Labels** — offer common labels from `AGENTS.md` if available
- **Sprint** — if sprint field exists and board supports it
- **Team / Squad / Feature / Theme** — only if present in metadata

Mark recommended/default options with "(Recommended)" in the label. Suggest values where you can infer them from context.

### 5. Write the canonical ticket spec

Do **not** hand-compose Jira Markdown. Jira's WYSIWYG editor expects Atlassian Document Format (ADF), and Markdown tables often land as plain text. Instead, write one canonical JSON spec and let the generator produce the exact Jira artifacts.

Create a local `ticket-spec.json` with this shape:

```json
{
  "projectKey": "ENG",
  "issueType": "Story",
  "summary": "Concise ticket title",
  "businessValue": [
    "Background/motivation from user input: what problem this solves and why it matters."
  ],
  "acceptanceCriteria": [
    "Given [context], when [action], then [expected result].",
    "Specific, verifiable statement about behavior."
  ],
  "implementationDetails": [
    "Optional technical details, links, or additional context."
  ],
  "labels": [],
  "components": [],
  "priority": "Medium",
  "storyPoints": 1,
  "sprint": 729,
  "fieldMappings": {
    "storyPoints": "customfield_20001",
    "sprint": "customfield_20002"
  },
  "assignee": "account-id-or-email-if-supported-by-acli",
  "parent": "ENG-123",
  "cloudId": "optional-cloud-id-for-mcp",
  "additionalFields": {}
}
```

Rules:

- Required: `projectKey`, `issueType`, `summary`, and at least one `acceptanceCriteria` item.
- `businessValue` and `implementationDetails` may be strings or arrays of strings.
- If the user selects story points, persist that choice as top-level `storyPoints`; do not leave it only in your notes. The generator maps `storyPoints` through `fieldMappings.storyPoints` and requires `fieldMappings.storyPoints` to contain the field ID resolved for the user's Jira site.
- If the user selects a sprint, persist the sprint id as top-level `sprint`; do not write the sprint name unless Jira explicitly expects a name. The generator maps `sprint` through `fieldMappings.sprint` and requires `fieldMappings.sprint` to contain the field ID resolved for the user's Jira site.
- Story point and sprint field IDs differ between Jira sites, so resolve them from Jira metadata and set `fieldMappings` before generating artifacts.
- Put Jira custom field values in `additionalFields` only after verifying the exact field IDs and allowed values from Jira metadata.
- Do not invent field IDs, option IDs, sprint IDs, story point fields, or team fields.
- For Stories, keep acceptance criteria as one string per table row. The generator renders Story ACs as a two-column table, not a bullet list.

### 6. Generate ADF and creation artifacts

Use the generator from a known location. **Do not glob or search the user's home directory** for `build-jira-ticket.mjs`; that triggers unnecessary external-directory permission prompts and can wander into unrelated projects.

Preferred path when running inside this repo, from the repository root:

```bash
npm run jira:ticket -- --input ticket-spec.json --out-dir /tmp/jira-ticket
```

If the skill was installed by the opencode plugin and the current project is not this repo, run the script from this skill's **base directory**. opencode shows the skill base directory when the skill is loaded, and relative files referenced by this skill are relative to that directory. Build the command by joining that base directory with `scripts/build-jira-ticket.mjs`:

```bash
node "<skill-base-directory>/scripts/build-jira-ticket.mjs" --input ticket-spec.json --out-dir /tmp/jira-ticket
```

If the relative script is missing from the loaded skill's base directory, report that the installed skill is incomplete and ask the user to reinstall or update the plugin. Do not search `~`.

The generator writes:

- `/tmp/jira-ticket/preview.md` — readable preview for the user
- `/tmp/jira-ticket/description.adf.json` — ADF description for Jira WYSIWYG
- `/tmp/jira-ticket/acli-workitem.json` — full `acli --from-json` payload for custom fields, parent subtasks, and ADF
- `/tmp/jira-ticket/acli-create.sh` — safe `acli jira workitem create` wrapper
- `/tmp/jira-ticket/mcp-create-issue.json` — Atlassian MCP create issue arguments using `contentFormat: "adf"`
- `/tmp/jira-ticket/rest-create-issue.json` — Jira REST API v3 create issue payload

### 7. Preview before creation

Read `/tmp/jira-ticket/preview.md` and show the user the complete preview, then proceed to creation if the user already asked you to create a ticket and all required fields are present. Do **not** ask for a final "Ready to create?" confirmation; creation was already requested.

Only stop for another `question` tool prompt if required information is missing, the user explicitly asked to preview before creating, or the preview reveals a blocking ambiguity. If edits are needed, update `ticket-spec.json`, rerun the same generator command used in step 6, and preview again. Do not hand-edit generated files unless you are only inspecting them.

### 8. Create the ticket

Use whichever Jira creation path is available in the current runtime. Do not force MCP if those tools are not registered, and do not force `acli` if MCP is available and requested.

Before delegating creation to a subagent, pass the generated artifacts by path and tell the subagent **not** to reconstruct the ticket from Markdown. The subagent should create from `/tmp/jira-ticket/mcp-create-issue.json` or `/tmp/jira-ticket/acli-workitem.json`. This avoids ad-hoc ADF conversion, field-shape guessing, and duplicate creates. Tiny dragons, fewer fires.

#### Atlassian MCP path

Use MCP when `atlassian_createJiraIssue` is available or the user explicitly asks for MCP:

1. Load `/tmp/jira-ticket/mcp-create-issue.json`.
2. If assigning to the current user, call `atlassian_atlassianUserInfo` and put the returned `accountId` in `additional_fields.assignee.accountId`.
3. If setting sprint, resolve the sprint id with Atlassian/Jira metadata first. If it cannot be resolved confidently, omit the sprint field and report that it was skipped.
4. Call `atlassian_createJiraIssue` with `contentFormat: "adf"` and the generated ADF object. If the MCP schema rejects object descriptions, stringify the generated ADF JSON. Do not convert back to Markdown.

#### acli path

Use `acli` when MCP tools are unavailable. First check:

```bash
acli jira auth status
acli jira workitem create --help
```

Always use the generated JSON payload for `acli` creation. This preserves the generated ADF structure reliably. Do not use `--description-file` for generated ADF unless the user explicitly requests a manual experiment; some `acli` versions return only `INVALID_INPUT` for ADF description files even when the same ADF is valid through `--from-json`.

```bash
sh /tmp/jira-ticket/acli-create.sh
```

The wrapper runs:

```bash
acli jira workitem create --from-json "/tmp/jira-ticket/acli-workitem.json" --json
```

acli notes:

- For "Assign to me", prefer creating without `assignee` unless you have already verified the project accepts assignment during create. Some Jira projects reject explicit assignment during create even though post-create assignment works or default assignment applies.
- If the user requested assignment to themselves, create the ticket first and capture the issue key once. Then attempt post-create assignment with `acli jira workitem assign --key <KEY> --assignee "@me" --json --yes` only if `acli jira workitem assign --help` confirms `@me` is supported. Verify the assignee afterward with `acli jira workitem view <KEY> --fields "assignee" --json`.
- If post-create assignment fails, report it clearly instead of claiming success. Do not recreate the ticket just to fix assignment; ask whether to leave it unassigned, assign to the project default, or use a specific email/account ID.
- If acli rejects only the assignee field during create and no issue key was returned, remove `assignee`, regenerate artifacts, and retry creation once. Do not keep retrying, and do not retry if Jira returned an issue key.
- For subtasks, set `parent` to the parent issue **key** (e.g. `the selected project-20485`), not the numeric issue id. acli's `parentIssueId` field accepts the key more reliably despite the name. Yes, that name is nonsense.
- Save create output once, for example `sh /tmp/jira-ticket/acli-create.sh | tee /tmp/jira-ticket/create-result.json`. Never rerun a create command just to capture output. Query the created issue by key for verification instead.
- Verify all fields with `acli jira workitem view <KEY> --fields "*all" --json`; the default `view --json` output only includes a subset and can make accepted fields look missing.

Set additional fields via Jira metadata-verified values only.

#### Sprint resolution

Do not use repeated trial-and-error JQL field requests to discover sprint ids. The fastest acli path is:

```bash
acli jira board search --project <PROJECT_KEY> --type scrum --json
acli jira board list-sprints --id <BOARD_ID> --state future,active --json
```

Choose the first real future sprint that matches the user's selection. Ignore placeholder sprints such as "Carry Over" unless the user picked them. If no future sprint can be determined, omit the sprint field and report that it was skipped.

### 9. Report result

After creation, display the ticket URL using your Jira base URL pattern (read from `AGENTS.md` or ask the user).

### 10. Optional QA subtask

If your project uses QA subtasks, create one after the parent ticket and link it. Do **not** assume a QA subtask type exists; confirm via Jira metadata or `AGENTS.md`.

For QA subtasks, create a second canonical spec after the parent key is known:

```json
{
  "projectKey": "PROJ",
  "issueType": "QA",
  "summary": "QA | Parent story summary",
  "businessValue": "QA coverage for the parent story.",
  "acceptanceCriteria": ["Verify acceptance criteria from parent story."],
  "parent": "PROJ-12345"
}
```

Regenerate artifacts into a separate directory such as `/tmp/jira-ticket-qa`, then create via the same MCP or acli path. Do not set sprint, assignee, component, or other metadata on the QA subtask unless the user/project explicitly requires it.

## Tips

- If the user pastes a Slack thread, design doc, or brain dump, extract the ticket structure from it rather than asking them to restate everything.
- Keep the conversation flowing naturally — this isn't a form, it's a collaboration.
- The AC refinement loop is the heart of this skill. Push for specificity and testability, but respect the user's domain knowledge.
- Always show the preview before creating. Do not ask for a redundant final confirmation when the user already asked you to create the ticket and required fields are present.
- The model decides ticket content; the generator decides Jira formatting. Never go back to hand-authored Markdown descriptions unless the user explicitly asks for a plain-text fallback.
