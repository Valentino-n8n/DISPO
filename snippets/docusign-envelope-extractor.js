/**
 * DocuSign Envelope ID Extractor
 * ==============================
 *
 * When a DocuSign envelope completes, DocuSign sends a notification email
 * to a configured operations inbox. This Code node parses that email body
 * to recover the envelope's UUID — needed to look up the corresponding
 * tracking row, customer, and downstream side effects (SharePoint upload,
 * Excel status update, Slack notification).
 *
 * DocuSign's notification HTML embeds the envelope ID in several possible
 * places:
 *   1. A "Review documents" link with `m=<UUID>` query parameter (preferred,
 *      since it appears in every notification template).
 *   2. An older `envelopeId=<UUID>` query parameter (some templates).
 *   3. The plain text body, after "Envelope ID:" or similar labels.
 *
 * We try them in order and stop at the first match. We also pull the
 * customer-facing serial number from the email subject for cross-reference.
 *
 * Used in: n8n Code node, immediately after the Outlook trigger that
 * watches the DocuSign-notifications inbox.
 *
 * Output: { envelopeId, customerSerial, source } — `source` indicates
 * which extraction strategy succeeded, useful when DocuSign changes its
 * email template.
 */

const subject = String($json.subject || "").trim();
const body =
  ($json.body && ($json.body.content || $json.body)) ||
  $json.bodyPreview ||
  "";

// --- Customer-facing serial from the subject line ---
// Adjust the regex to match your operations team's serial format.
let serialMatch = subject.match(/\[(SRL-\d+)\]/i) || subject.match(/SRL-\d+/i);
const customerSerial = serialMatch ? serialMatch[1] || serialMatch[0] : "";

// --- Envelope UUID from body ---
const uuidPattern =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

let envelopeId = "";
let source = "";

// Strategy 1: m=<uuid> query parameter (most reliable)
let m = /[?&]m=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
  body,
);
if (m) {
  envelopeId = m[1];
  source = "m-param";
}

// Strategy 2: envelopeId=<uuid> query parameter
if (!envelopeId) {
  m = /[?&]envelopeId=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
    body,
  );
  if (m) {
    envelopeId = m[1];
    source = "envelopeId-param";
  }
}

// Strategy 3: "Envelope ID:" label followed by a UUID
if (!envelopeId) {
  m = /envelope\s*id\s*[:\-]?\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
    body,
  );
  if (m) {
    envelopeId = m[1];
    source = "label";
  }
}

// Strategy 4: any UUID in the body — last-resort fallback
if (!envelopeId) {
  m = uuidPattern.exec(body);
  if (m) {
    envelopeId = m[1];
    source = "loose-uuid";
  }
}

if (!envelopeId) {
  // Throw so the n8n execution log clearly flags the bad email.
  // The operator can then forward / inspect manually.
  throw new Error(
    `No envelope ID could be extracted from email subject="${subject}"`,
  );
}

return {
  json: {
    envelopeId,
    customerSerial,
    source,
    sourceSubject: subject,
  },
};
