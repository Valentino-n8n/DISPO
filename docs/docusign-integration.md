# DocuSign Integration Pattern

End-to-end pattern for embedding DocuSign envelope signing into an
operations workflow: send the envelope, track its status, react when
the customer signs, and route the signed PDF to the correct destination.

## The two halves

DocuSign integration is **never one workflow**. It's two:

1. **Send + track** — runs synchronously when a new booking is created.
   Builds the envelope payload, calls the DocuSign API, writes the
   envelope ID to a tracking sheet, and ends. The customer will sign
   when they get around to it — minutes, hours, or days later.

2. **Completion handler** — runs asynchronously when DocuSign notifies
   us that the envelope is signed. Pulls the signed PDF, looks up the
   tracking row by envelope ID, derives the destination folder, and
   uploads.

These two have to be in separate workflows because the time between them
is unbounded. A single workflow that "sends and waits" would block an
n8n execution for days, hit timeout, and break the whole pattern.

---

## Half 1 — Send + track

### Envelope payload assembly

DocuSign envelopes carry tabs (form fields) populated from your data.
The Code node before the API call assembles the payload as a typed
object — never as a hand-built string — so a missing field surfaces as
a clear error rather than a malformed JSON request.

```js
return {
  json: {
    apiBase: env.apiBase,
    accountId: env.accountId,
    envelopeData: {
      emailSubject: `Liability Confirmation — ${customer.bookingId}`,
      documents: [{
        documentBase64: pdfBase64,
        name: "LiabilityCertificate.pdf",
        fileExtension: "pdf",
        documentId: "1",
      }],
      recipients: {
        signers: [{
          email: customer.email,
          name: customer.name,
          recipientId: "1",
          routingOrder: "1",
          tabs: {
            textTabs: [
              { tabLabel: "City", value: customer.city, locked: "true" },
              { tabLabel: "Date", value: customer.date, locked: "true" },
            ],
            signHereTabs: [
              { tabLabel: "Signature", anchorString: "/sig1/" },
            ],
          },
        }],
      },
      status: "sent",
    },
  },
};
```

Validate the customer record before this step. If `email` is missing
the API call will return a 400 — easier to throw early in a Code node
with a clear message than to debug an opaque DocuSign error response.

### Multi-channel delivery

The same envelope can be delivered as:

- **Email** (default): DocuSign emails the signing link.
- **Embedded signing URL**: useful when the customer is already logged
  into a portal you control — generates a short-lived URL that drops
  them straight into the signing UI.
- **SMS via your provider** + plain link: the SMS message includes the
  signing URL. Used as a fallback when customers don't open emails.

The decision of which channel to use is data-driven: check the
customer's communication preference, fall back to email if unset.

### Tracking row

Immediately after the API call returns the envelope ID, write a row
to a tracking sheet:

| EnvelopeID | CustomerSerial | Region | Status | SentAt | ReminderSent |
|---|---|---|---|---|---|
| 0a1b2c... | SRL-1042 | Munich | sent | 2026-05-10T10:30:00Z | false |

This row is the source of truth for everything downstream. The
completion handler looks up by `EnvelopeID`. The reminder workflow
looks up by `Status === "sent" AND SentAt < now - 2 days`.

---

## Half 2 — Completion handler

### Trigger

DocuSign sends a notification email when an envelope completes. We
trigger on that email rather than polling the DocuSign API — polling
is expensive and adds latency. The Outlook trigger watches a dedicated
DocuSign-notifications inbox.

### Envelope ID extraction

The notification email contains the envelope UUID in the body, but
DocuSign's email template has shifted format multiple times. We try
several extraction strategies in order of reliability:

```
1. ?m=<UUID>          (current default link parameter)
2. ?envelopeId=<UUID> (older template)
3. "Envelope ID:" prefix in plain text
4. Any UUID in the body (last-resort fallback)
```

See [`snippets/docusign-envelope-extractor.js`](../snippets/docusign-envelope-extractor.js)
for the full implementation. The extracted `source` field tells us
which strategy worked — if it's ever the fallback, that's a signal
DocuSign changed their template and we should update the regex.

### Cross-region routing

Tracking sheets are partitioned by region (one per regional ops team).
The completion handler doesn't know which region an envelope belongs
to — it has only the envelope ID. The lookup fans out across all
regional sheets in parallel and picks the first match:

```
Extract Envelope ID
        │
        ├──► Lookup Tracking Sheet (Munich)  ──┐
        ├──► Lookup Tracking Sheet (Mainz)   ──┤
        └──► Lookup Tracking Sheet (Berlin)  ──┤
                                                │
                                  ┌─────────────▼──────────────┐
                                  │ Find Region by Envelope ID │
                                  │  (return first non-empty)  │
                                  └─────────────┬──────────────┘
                                                │
                                                ▼
                                  Pick region-specific destination folder
```

### Destination folder resolution

Once we know the region and customer, we derive the SharePoint folder:

```
{region}/{service-type-subfolder}/{customer-folder}/{filename}.pdf

e.g.
Munich/Disassembly/Mueller_GmbH__SRL-1042/Liability_Cert.pdf
```

See [`snippets/folder-path-sanitizer.js`](../snippets/folder-path-sanitizer.js)
for the full path-building logic. Naming has to handle Unicode customer
names, illegal Windows characters, and length limits.

### Status update

After the upload succeeds, we update the tracking row's status to
`completed` and write the SharePoint URL into a `SignedPDFUrl` column.
This row is now the audit trail: it answers "when was this signed?"
and "where is the signed copy?" without anyone digging through emails.

---

## Failure modes you'll hit in production

| Failure | Mitigation |
|---|---|
| DocuSign template changes — envelope ID extraction fails | Multi-strategy extractor, log the strategy that worked, monitor for "loose-uuid" / "label" matches |
| Customer never signs — tracking row stuck in "sent" | Reminder workflow scans for `sent AND SentAt > 2 days ago` and triggers an SMS reminder |
| Notification email arrives before the tracking row is written (race) | Envelope ID lookup includes a retry with backoff; the workflow doesn't fail the first time, it waits and retries |
| Customer name with `/` or `\` breaks SharePoint upload | Run all customer-derived strings through the path sanitizer before any Graph API call |
| Same envelope completes twice (duplicate notification) | Tracking row's `Status === "completed"` is the idempotency check; the handler skips if already complete |
