# n8n Multi-Region Dispatch Pattern

A reference architecture for building a multi-region operational dispatch
system in n8n, with email triggers, AI-assisted parsing, modular
sub-workflows per region, human-in-the-loop approval gates, asynchronous
DocuSign signing, scheduled reminders, and daily Slack summaries, all
across Microsoft 365, DocuSign, ClickSend, Slack, and Azure OpenAI.

This repository documents the architecture decisions, code patterns, and
design trade-offs from a multi-region dispatch system I built and operate
in production.

> Customer data, credentials, tenant identifiers, internal SharePoint
> paths, DocuSign envelope IDs, and the live workflow JSON are not part
> of the public material. The patterns and JavaScript helpers below are
> generalized: field names use generic placeholders, project-specific
> identifiers are removed, and comments are translated to English.

---

## What this pattern solves

A logistics operation receives structured dispatch emails from multiple
regional offices. Each booking has its own downstream consequences:

- Folder creation in SharePoint, partitioned by region and service type
- Tracking row in Excel for operations dashboards
- Signed liability certificate via DocuSign (asynchronous, customer
  signs hours or days later)
- Confirmation SMS to the customer
- Day-before preparation SMS (scheduled)
- Reminder SMS if the certificate isn't signed within 2 days
- Slack summary at end of day
- Cross-region SharePoint upload when the signed PDF arrives back

Doing this manually costs ~30 minutes per booking, has zero audit trail,
and breaks down completely when staff are on holiday. The automated
system runs continuously and surfaces only the rows that need a human
decision.

---

## Architecture at a glance

```
┌─────────────────── Layer 1: Trigger ────────────────────┐
│   Outlook Trigger (Region A)  ─┐                        │
│   Outlook Trigger (Region B)  ─┤── Switch ─► Pre-Dispatch│
│   Outlook Trigger (Region C)  ─┘            (per region) │
└──────────────────────────────────────────────────────────┘
                                                  │
┌─────────────── Layer 2: Pre-Dispatch ───────────▼────────┐
│   HTML strip → AI parse → sanitize → approval gate       │
│        → folder + Excel + DocuSign + SMS + Slack         │
│  (calls Layer 3 sub-workflows via executeWorkflow)       │
└──────────────────────────────────────────────────────────┘
                                                  │
┌─────────────── Layer 3: Sub-workflows ──────────▼────────┐
│  Synchronous (called from Layer 2):                      │
│    • Daily duty roster lookup                            │
│    • Project manager onboarding to master table          │
│    • DocuSign envelope creation                          │
│    • ClickSend SMS sending                               │
│    • PDF operations helper                               │
│                                                          │
│  Asynchronous (own triggers):                            │
│    • DocuSign completion → SharePoint upload             │
│    • Day-before SMS reminders (cron)                     │
│    • Daily summary + overdue escalation (cron)           │
└──────────────────────────────────────────────────────────┘
```

See [`docs/architecture.md`](docs/architecture.md) for the full system
breakdown including the sub-workflow inventory.

---

## Repository structure

```
.
├── README.md                          ← you are here
├── docs/
│   ├── architecture.md                ← full system architecture
│   ├── docusign-integration.md        ← envelope send + webhook completion
│   └── scheduled-workflows.md         ← cron + reminders + daily summary
└── snippets/
    ├── README.md                      ← snippet index
    ├── llm-output-sanitizer.js        ← clean LLM output before downstream
    ├── email-html-stripper.js         ← strip HTML from Outlook body
    ├── batch-deduplication.js         ← unique-key processing in loops
    ├── data-shape-transformer.js      ← raw spreadsheet → clean shape
    ├── binary-attachment-extractor.js ← fan out email attachments
    ├── appointment-date-filter.js     ← robust "tomorrow" filter
    ├── docusign-envelope-extractor.js ← parse envelope ID from notification email
    ├── folder-path-sanitizer.js       ← safe SharePoint path generation
    └── scheduled-summary-aggregator.js← daily Slack summary builder
```

All snippets come from production Code nodes, generalized for public
release: field names use generic placeholders, project-specific
identifiers are removed, and comments are translated to English.

---

## Tech stack

- **Orchestration:** n8n (cloud)
- **Triggers:** Microsoft Outlook, Schedule (cron), DocuSign notification webhook
- **AI:** Azure OpenAI (GPT-4 family) with LangChain Structured Output Parser
- **Storage:** Microsoft Excel (via Microsoft Graph), Microsoft OneDrive,
  SharePoint
- **External APIs:** DocuSign eSignature, ClickSend SMS, Microsoft Graph
- **Notifications:** Slack (App Home + DMs + channel posts)
- **Code:** in-node JavaScript (Code nodes); ~3,500 LOC across all
  workflows in the system

---

## Why publish this?

I learned a lot building this system, and I couldn't find an open
reference for the integration patterns I needed (Outlook ⇄ AI agent ⇄
approval gate ⇄ Microsoft 365 ⇄ DocuSign ⇄ scheduled reminders).
Publishing the patterns is the smallest contribution back to the
community I borrowed from.

If you're building something similar and have questions, open an issue.

---

## About

Built and maintained by [Valentino Veljanovski](https://valentinoveljanovski.de),
automation developer based in München. The full case study for the
production system this pattern came from is at
[valentinoveljanovski.de/projects/dispo](https://valentinoveljanovski.de/projects/dispo).

---

## Viewing Notice

This repository is published for portfolio demonstration and educational
viewing only.

All code, documentation, diagrams, and content in this repository remain
the intellectual property of the author. **All rights reserved.**

No license is granted, expressed or implied, for reuse, redistribution,
modification, or commercial use of any material in this repository
without prior written permission from the author.

For licensing or collaboration inquiries, contact: <valentinoveljanovski@outlook.com>