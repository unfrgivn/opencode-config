---
name: fetch-jira-field-options
description: "Internal helper — called by other skills. Fetch the allowed values for a Jira custom field (e.g. Feature, Component, Squad) from the project's issue type metadata. Returns a list of {name, id} pairs."
---

# Fetch Jira Field Options

Dynamically fetch allowed values for Jira fields. Prefer Jira issue-type
metadata when available, but do not assume any one runtime is present. The
caller should be able to use this helper whether the session has Atlassian MCP
tools, `acli`, or only enough information to report a clear limitation.

## Inputs

The calling skill must specify:

- **Field key** — The Jira field key (e.g. `customfield_20003`, `components`, `customfield_20004`). **Required.**
- **Issue type ID or name** — Required; resolve it for the selected project.
- **Project key** — Required; resolve it with `resolve-project-key` or ask the user.
- **Runtime preference** — Optional: `mcp`, `acli`, or `auto`. Default: `auto`.

## Steps

### 1. Normalize the request

Resolve the project key, issue type, and field key up front. Do not assume a project, issue type, or custom field mapping. The caller must provide values resolved for the user’s Jira site.

Do not invent field IDs. If the caller asks for a field by label only, ask for
the exact Jira field key or use a known mapping supplied by the caller.

### 2. Prefer any Jira MCP field-options path when available

If a Jira MCP field-options or create-metadata tool is registered in the current
runtime, use it. This is the best path for custom field allowed values. Do not
assume only one MCP server naming convention exists.

Supported MCP shapes, in preference order:

1. A direct field-options tool, commonly named `jira_get_field_options` or
   `atlassian_jira_get_field_options`.
2. A create-fields metadata tool, commonly named `jira_get_create_fields`,
   `get_create_fields`, `get_issue_type_fields`, or
   `atlassian_getJiraIssueTypeMetaWithFields`.
3. A project issue-type metadata tool, commonly named
   `atlassian_getJiraProjectIssueTypesMetadata`, only if it returns fields for
   the selected issue type.

If more than one exists, use the most specific/direct tool. Do not skip MCP just
because `atlassian_getJiraIssueTypeMetaWithFields` specifically is absent.

For a direct field-options tool, call it with the normalized field key, project
key, and issue type name or ID. Return the options exactly as Jira reports them,
normalizing to `{name, id}`.

For create-fields metadata tools, call with:

- **Cloud ID:** read from repo instructions if available, otherwise ask the
  user only if that specific MCP tool requires it.
- **Project ID or key:** the normalized project key.
- **Issue type ID:** the normalized issue type ID.

Find the field matching the requested field key in the response's fields. Extract
`allowedValues` or `values`, returning each entry as `{name, id}` where `name` is
the first available display property in this order:

1. `name`
2. `value`
3. `displayName`
4. `id`

If an allowed value has child options, include the child options indented or as
`parent › child`, preserving both IDs. For a team or squad field such as `customfield_20001`, the expected successful outcome is a list of real values from Jira. Returning only `None / skip` and `Custom` means the lookup did
not succeed.

### 3. Use `acli` when MCP is unavailable

If MCP tools are unavailable, use `acli` where it can provide authoritative
values. First check authentication:

```bash
acli jira auth status
```

Then use the narrowest command for the requested field:

- `components`: `acli jira project view --key <PROJECT_KEY> --json`, then read
  `.components[]` and return `{name, id}`.
- `issuetype` / issue types: `acli jira project view --key <PROJECT_KEY> --json`,
  then read `.issueTypes[]` and return `{name, id}`.
- `customfield_20002` / sprint: use board commands, not field metadata:
  ```bash
  acli jira board search --project <PROJECT_KEY> --type scrum --json
  acli jira board list-sprints --id <BOARD_ID> --state active,future --json
  ```
  Return real active/future sprint `{name, id}` values and ignore placeholders
  like `Carry Over` unless the caller specifically asks for them.

For arbitrary custom fields such as `customfield_20001`, `acli` currently does
not expose issue-create metadata or custom field `allowedValues` directly. Do
not scrape unrelated issues, do not substitute components, and do not hardcode
examples. If MCP is unavailable and the requested custom field is not one of the
special acli-supported fields above, report:

```text
Could not fetch allowed values for <fieldKey> with the current runtime. Atlassian MCP issue-type metadata is unavailable, and acli does not expose allowedValues for arbitrary custom fields. Ask the user for the value or retry in a runtime with Atlassian MCP.
```

Do not silently return only fallback options for custom fields that should have
allowed values. Make the limitation explicit so the caller can decide whether to
pause, retry with MCP enabled, or ask the user for a custom value.

### 4. Optional REST fallback only when credentials are already available

If the caller has an explicitly configured Jira REST authentication method
already available in the environment, it may call Jira create/edit metadata and
extract `allowedValues`. Do not ask the user for API tokens inside this helper,
and do not inspect credential files.

Preferred Jira Cloud endpoint:

```text
GET /rest/api/3/issue/createmeta/<PROJECT_KEY>/issuetypes/<ISSUE_TYPE_ID>
```

Look for the requested field key in the returned `fields` collection and extract
`allowedValues` or `values` using the same `{name, id}` rules as the MCP path.
Use this REST fallback only when authentication is already explicit in the
runtime; do not try to reverse-engineer `acli` OAuth storage.

Use Jira's create/edit metadata shape, find the requested field key, then extract
`allowedValues` using the same `{name, id}` rules as the MCP path.

## Output

A list of options, e.g.:

```
- Anomaly Detection (11013)
- Benchmark Explorer (10988)
- Bid & Budget (10985)
...
```

If the field has no `allowedValues`, report that the field is free-text, not
present for the selected issue type, or unavailable in the current runtime. Be
specific about which lookup path was used.
