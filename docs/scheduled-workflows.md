# Scheduled Workflow Patterns

n8n's strength is event-triggered automation, but a real operations
system also needs **scheduled** workflows — daily summaries, day-before
reminders, overdue-item escalations. This page covers the patterns
used in this dispatch system.

## Three classes of scheduled workflow

### 1. Day-before reminders

Run early each morning. Find appointments scheduled for tomorrow.
Send each customer a preparation SMS with what they need to do before
the visit ("defrost the freezer, remove valuables, etc.").

```
Schedule: 0 8 * * *  (08:00 Munich time)
    │
    ▼
Read appointments table
    │
    ▼
Filter rows where AppointmentDate === tomorrow
    │   (see snippets/appointment-date-filter.js)
    ▼
For each row → send SMS via ClickSend
    │
    ▼
Append SMS log row (recipient, message, http status, timestamp)
    │
    ▼
Slack notification: "Sent X reminder SMS for tomorrow"
```

The filter step is the bulk of the complexity. Spreadsheet date
columns are notoriously inconsistent — German `DD.MM.YYYY`, ISO
`YYYY-MM-DD`, Excel serial numbers, plain strings, sometimes empty.
The filter has to recognize and normalize all of these without
silently dropping a real appointment.

### 2. Daily summary

Run end-of-day. Compile a single Slack message with the day's
operational metrics:

- How many SMS reminders went out?
- How many envelopes were sent?
- How many envelopes are still unsigned?
- What's tomorrow's appointment load?

```
Schedule: 0 18 * * *  (18:00 Munich time)
    │
    ▼
Read SMS log
    │       Read tracking sheet
    │       │
    └───┬───┘
        ▼
Generate counts (today, tomorrow, overdue)
    │   (see snippets/scheduled-summary-aggregator.js)
    ▼
Format Slack message
    │
    ▼
Post to operations channel
```

Empty result handling matters here. If no SMS went out today and no
appointments are tomorrow, the workflow still posts a summary saying
"0 today, 0 tomorrow". This way operators know the workflow ran;
silence would be ambiguous (did the cron fire? did the workflow
break?).

### 3. Overdue escalation

Run multiple times per day. Find tracking rows that have been in
"sent" status for longer than a threshold (e.g. 2 days) and haven't
yet had a reminder sent.

```
Schedule: 0 9,14 * * *  (09:00 and 14:00)
    │
    ▼
Read tracking sheet
    │
    ▼
Filter: Status === 'sent'
        AND SentAt < now - 2 days
        AND ReminderSent !== true
    │
    ▼
For each → send SMS reminder
    │
    ▼
Update tracking row: ReminderSent = true, ReminderSentAt = now
    │
    ▼
Slack alert: "Sent N overdue reminders"
```

The `ReminderSent` flag is critical — without it, the workflow would
spam the same customer every run.

---

## Designing the schedule

Avoid the trap of running scheduled workflows every minute "just in
case." Each n8n execution costs CPU + I/O on Microsoft Graph. Instead:

| Frequency | Use case |
|---|---|
| Once per day | Reminders, summaries (the workflow's job is irreversibly time-anchored) |
| Twice per day | Overdue escalation (faster customer response without spam) |
| Hourly | Status sync from external API where the API has its own rate limit |
| Every 5 min | Avoid unless you have a real-time SLA (and use webhooks instead) |

If a scheduled workflow does the same thing as an event-driven one,
delete the scheduled one. Webhooks beat polling.

---

## Idempotency requirements

Scheduled workflows can be re-run by accident: someone clicks "Execute
Workflow" manually after the cron already fired, or the previous run
crashed mid-way. Each downstream side effect needs to be safe to repeat:

- **SMS sends**: log to a tracking sheet *before* the API call fires.
  After the call, update the same row with the http status. If the
  workflow re-runs, the dedup filter (`SentAt > today midnight`) skips
  rows that already have a logged send.
- **Tracking-sheet updates**: use Excel's "update row by ID" rather
  than "append" — appending creates duplicates.
- **Slack messages**: post once per cron run; include the date in the
  message so a duplicate post is visually obvious to the operator.

---

## Error handling

Every scheduled workflow should have a catch path that posts to a
private "automation errors" Slack channel. Without this, a silent
failure means nobody finds out until tomorrow's customers complain
that no SMS went out.

```
[scheduled trigger]
    │
    ▼
[read source data] ───► error ───► Slack #automation-errors
    │                              "Failed to read sheet, code=ECONNRESET"
    ▼
[business logic]   ───► error ───► same channel
    │
    ▼
[side effect]      ───► error ───► same channel
    │
    ▼
[success]
```

The error handler should include:
- Workflow name
- Failing step name
- Error message (truncated)
- Execution URL in n8n (so the operator can click straight to the
  failed run and inspect the data)

This single Slack channel becomes the operations team's morning
checklist: scroll through, see what broke overnight, fix.
