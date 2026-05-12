# System Architecture

The dispatch automation system is split into three layers:

1. **Trigger layer** — region-scoped Outlook triggers, one per regional
   inbox, all funneled into a single Switch node that routes the email
   to the correct downstream workflow.
2. **Pre-Dispatch layer** — one orchestrator workflow per region, each
   running ~60–100 nodes of regional business logic. Calls into the
   sub-workflow layer for unit-of-work tasks.
3. **Sub-workflow layer** — focused workflows for individual concerns
   (DocuSign envelope, SMS, SharePoint upload, daily summary). Called
   via `executeWorkflow` from the Pre-Dispatch layer or fired on their
   own schedules.

This layering keeps each region's business rules isolated. When the
Mainz team changes how they assign project managers, only the Mainz
sub-workflow needs to update. When DocuSign changes their notification
format, only the completion-handler workflow updates. The trigger
layer and Pre-Dispatch layer keep running unchanged.

---

## Layer 1 — Trigger router

**Workflow:** `DISPATCH DEUTSCHLAND` — 8 nodes total.

```
   Outlook Trigger (Region A inbox)  ──┐
   Outlook Trigger (Region B inbox)   ─┤
   Outlook Trigger (Region C inbox)   ─┤
                                        │
                                  ┌─────▼─────┐
                                  │  Switch   │  routes by trigger source
                                  └─────┬─────┘
                                        │
                ┌───────────────────────┼───────────────────────┐
                ▼                       ▼                       ▼
        executeWorkflow:        executeWorkflow:        executeWorkflow:
        Pre-Dispatch A          Pre-Dispatch B          Pre-Dispatch C
```

Each trigger marks the email as read in a region-specific folder
before delegating, so a temporary outage of the Pre-Dispatch workflow
doesn't cause the trigger to keep re-firing on the same email.

**Why one workflow per region instead of conditional logic in a single
workflow:** conditional logic creates fragile coupling. Adding a fourth
region means editing the central workflow and re-testing the entire
system. Per-region workflows mean you build, test, and deploy a fourth
region without touching the existing three.

---

## Layer 2 — Pre-Dispatch orchestrators

One per region, ~60–100 nodes each. The Munich variant has 96 nodes.

The general flow:

```
Trigger input (forwarded email metadata + body + attachments)
    │
    ▼
Strip HTML from body  ──────────────┐
    │                                │
    ▼                                │
AI Agent (Azure OpenAI + Structured  │  See: docs/ai-parsing-pattern.md
Output Parser) extracts customer     │
data into a strict JSON schema.      │
    │                                │
    ▼                                │
Sanitize LLM output                  │  See: snippets/llm-output-sanitizer.js
    │                                │
    ▼                                │
Slack approval gate ─── deny ───────►│ exit
    │ approve                        │
    ▼                                │
Create customer folder (OneDrive)    │
    │                                │
    ▼                                │
Extract & upload binary attachments  │  See: snippets/binary-attachment-extractor.js
    │                                │
    ▼                                │
Append tracking row (Excel)          │  See: snippets/data-shape-transformer.js
    │                                │
    ▼                                │
Trigger DocuSign envelope ──────────►│ async, see Layer 3 below
    │                                │
    ▼                                │
Send SMS confirmation                │
    │                                │
    ▼                                │
Post Slack ops summary               │
    │                                │
    ▼                                │
Mark complete                        │
```

### Key design decisions

**LLM output is never trusted directly.** Every field returned by the
AI agent goes through a sanitization Code node which trims, validates,
and rejects malformed values. Without this, a single hallucinated extra
newline in a customer email field silently breaks an Excel filter or
DocuSign envelope.

**Approval gate before write.** The system never commits to the
spreadsheet without human confirmation. The Slack approval message
contains the parsed JSON — the operator clicks ✅ or ❌. This catches
the ~5% of cases where the LLM misreads or the email format changes
unexpectedly.

**Async DocuSign.** The DocuSign envelope is triggered but not awaited.
The signed PDF is uploaded later by a separate workflow listening to
DocuSign webhooks. This avoids blocking on user signature (can take
days). See [`docusign-integration.md`](./docusign-integration.md).

**Loop-context deduplication.** When a batch contains multiple bookings
for the same project manager, only one summary email goes out. See
[`snippets/batch-deduplication.js`](../snippets/batch-deduplication.js).

---

## Layer 3 — Sub-workflows

Sub-workflows are called by the Pre-Dispatch orchestrator via
`executeWorkflow`, OR fire on their own schedules / webhook triggers.
Each handles one well-defined concern.

### Synchronous sub-workflows (called from Pre-Dispatch)

| Workflow | Nodes | Purpose |
|---|---:|---|
| **Main Dispatch (Dienstplan)** | 15 | Read the daily duty roster from Excel, derive which crew is assigned to this booking, return the assignment to the caller. |
| **New PM with Haupttabelle** | 16 | When a new project manager appears in an incoming dispatch, append them to the master tracking table with normalized contact info. |
| **DocuSign Liability Certificate** | 18 | Build the envelope payload for the booking's liability certificate, call DocuSign API, write the resulting envelope ID into the regional tracking sheet. |
| **ClickSend SMS (service-specific)** | 12 | Send the customer a service-type-specific preparation SMS via ClickSend, with retry on transient errors. |
| **PDF Operations Helper** | 33 | HTTP-based document processing pipeline — fetch, transform, store. Used for non-DocuSign document flows. |

### Asynchronous sub-workflows (own triggers)

| Workflow | Trigger | Nodes | Purpose |
|---|---|---:|---|
| **DocuSign Completed → SharePoint Upload** | Outlook (DocuSign notification email) | 34 | Parse envelope ID from notification, look up the tracking row across all regional sheets, fetch the signed PDF from DocuSign, upload to the region-specific SharePoint folder. See [`docusign-integration.md`](./docusign-integration.md). |
| **SMS Reminder — 1 day before appointment** | Schedule (daily 08:00) | 51 | Read appointments table, filter rows scheduled for tomorrow, send each customer a preparation SMS. See [`scheduled-workflows.md`](./scheduled-workflows.md). |
| **Insurance Reminder + Daily Summary** | Schedule (daily 18:00 + 09:00, 14:00 escalation) | 123 | The largest workflow in the system. Three responsibilities: (1) daily summary post to Slack, (2) overdue-envelope detection + SMS reminder, (3) tomorrow-appointment status check. |

---

## Workflow size and complexity

The Insurance Reminder workflow at 123 nodes / 22 Code nodes /
~2,700 lines of in-node JavaScript is a candidate for further
decomposition. In practice it stays as one workflow because:

- All three of its responsibilities operate on the same two source
  sheets (DocuSign tracking + SMS log). Splitting them would mean
  reading those sheets three times instead of once.
- The three responsibilities run on different schedules (18:00 vs
  09:00 vs 14:00) but use a Schedule trigger with three branches —
  this is a single point of cron config rather than three.
- The shared error-handler post to Slack lives once in this workflow.
  Three workflows would mean three error handlers to maintain.

**Heuristic for splitting workflows:** if responsibilities are
*temporally* coupled (run at the same time on the same data), keep
them together. If they're *causally* coupled (one triggers the other),
split them with `executeWorkflow`. The DocuSign send and DocuSign
completion are causally coupled but the time gap is unbounded —
hence two workflows. The three things the Insurance Reminder does
are temporally coupled — hence one workflow.

---

## Where to look next

- **AI parsing details** → [`ai-parsing-pattern.md`](./ai-parsing-pattern.md) _(coming)_
- **Approval gate implementation** → [`approval-gate.md`](./approval-gate.md) _(coming)_
- **DocuSign send + completion** → [`docusign-integration.md`](./docusign-integration.md)
- **Scheduled workflow patterns** → [`scheduled-workflows.md`](./scheduled-workflows.md)
- **Code snippets** → [`../snippets/README.md`](../snippets/README.md)
