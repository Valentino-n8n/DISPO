/**
 * LLM Output Sanitizer
 * ====================
 *
 * Pattern for cleaning structured output from an LLM agent (e.g., Azure
 * OpenAI / GPT-4) before it enters downstream nodes (Excel writes, API
 * calls, conditional logic).
 *
 * Why this matters in production:
 * - LLM responses often contain trailing whitespace, newlines, smart quotes,
 *   zero-width characters, and other artifacts that break exact-match
 *   conditionals or cause spreadsheet rendering issues.
 * - Email fields returned by an LLM occasionally contain spurious whitespace
 *   or wrong casing — we validate and normalize them.
 * - Date/time fields need parsing and re-formatting to a canonical form
 *   before being written to a database or spreadsheet column.
 *
 * Used in: n8n Code node, immediately after the AI Agent / Structured
 * Output Parser node.
 *
 * Input shape:  { output: { customerName, customerEmail, ... } }
 *           or  { customerName, customerEmail, ... } (flat)
 *
 * Output: a single item with sanitized fields, ready for downstream use.
 */

const raw = $json.output || $json;

// --- helpers ---

function sanitizeText(value) {
  if (!value) return "";
  return String(value)
    .replace(/[\r\n\t]+/g, " ")          // collapse line breaks / tabs
    .replace(/\s{2,}/g, " ")             // collapse multiple spaces
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, ""); // remove zero-width chars
}

function sanitizeEmail(value) {
  if (!value) return "";
  const email = String(value)
    .replace(/[\r\n\t\s]+/g, "")
    .toLowerCase()
    .trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) ? email : "";
}

function sanitizePhone(value) {
  if (!value) return "";
  // Keep digits, spaces, +, -, ()
  return String(value)
    .replace(/[^\d+\s\-()]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanitizeDate(value) {
  if (!value) return "";
  // Accept ISO-8601 or German format (DD.MM.YYYY) and normalize to ISO.
  const cleaned = String(value).replace(/[\r\n\t]+/g, "").trim();
  const germanDate = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(cleaned);
  if (germanDate) {
    const [, dd, mm, yyyy] = germanDate;
    return `${yyyy}-${mm}-${dd}`;
  }
  // Already ISO or recognizable — let JS parse
  const parsed = new Date(cleaned);
  return isNaN(parsed.getTime()) ? cleaned : parsed.toISOString().split("T")[0];
}

// --- main ---

return {
  json: {
    customerName: sanitizeText(raw.customerName),
    customerEmail: sanitizeEmail(raw.customerEmail),
    customerPhone: sanitizePhone(raw.customerPhone),
    customerAddress: sanitizeText(raw.customerAddress),
    appointmentDate: sanitizeDate(raw.appointmentDate),
    bookingId: sanitizeText(raw.bookingId),
    projectManager: sanitizeText(raw.projectManager),
    projectManagerEmail: sanitizeEmail(raw.projectManagerEmail),
    company: sanitizeText(raw.company),
    notes: sanitizeText(raw.notes),
  },
};