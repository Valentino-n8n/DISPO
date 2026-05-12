/**
 * Appointment Date Filter ("Tomorrow")
 * ====================================
 *
 * Finds rows from a master appointments table that fall on a target
 * date (typically tomorrow), used to drive day-before SMS reminders.
 *
 * Why this is more than a one-liner:
 * - Source rows arrive from Excel / Microsoft Graph with mixed date formats:
 *   ISO ("2026-05-11"), German ("11.05.2026"), Excel serial numbers, and
 *   sometimes empty / placeholder strings. The filter has to survive all
 *   of these without silently dropping a real appointment.
 * - Customer names can include zero-width characters, encoding artifacts,
 *   and accented characters that need to be preserved (Müller, Großmann)
 *   while invisible noise is stripped.
 * - Phone numbers can come in three formats; we normalize to E.164-ish.
 * - Failures must be loud: a bad row should appear in the n8n execution
 *   log with WHY it was excluded, never silently skipped.
 *
 * Used in: n8n Code node, after a "Read Excel sheet" step that returns
 * all appointment rows.
 *
 * Output: only the rows scheduled for the target date, with a normalized
 * shape ready for the SMS-sending node downstream.
 */

const DEBUG = false; // flip to true while iterating; off in production
const MAX_NAME_LENGTH = 35;

// ---------- helpers ----------

const log = (msg) => {
  if (DEBUG) console.log(`[FILTER] ${msg}`);
};

function safeGet(obj, possibleKeys, defaultValue = "") {
  for (const key of possibleKeys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return defaultValue;
}

function stripInvisibleChars(s) {
  return String(s).replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "");
}

function truncateName(name, max = MAX_NAME_LENGTH) {
  const clean = stripInvisibleChars(String(name)).trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

/** Parse any reasonable date representation to a YYYY-MM-DD string. */
function parseDateFlexible(raw) {
  if (raw === null || raw === undefined || raw === "") return null;

  // Excel serial numbers (rare but possible): days since 1900-01-01
  if (typeof raw === "number") {
    const ms = (raw - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  const s = String(raw).trim();

  // German DD.MM.YYYY
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (de) {
    const [, dd, mm, yyyy] = de;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  // ISO YYYY-MM-DD or YYYY-MM-DDThh:mm
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const [, yyyy, mm, dd] = iso;
    return `${yyyy}-${mm}-${dd}`;
  }

  // Last-ditch: Date.parse
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  return null;
}

function normalizePhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return digits;
  // Default to German country code if missing — adjust per your domain.
  if (digits.startsWith("0")) return "+49" + digits.slice(1);
  return digits;
}

// ---------- main ----------

const allInputs = $input.all();

// Compute target date (tomorrow). For "today", use new Date() and skip the +1.
const target = new Date();
target.setDate(target.getDate() + 1);
const targetIso = target.toISOString().slice(0, 10);

log(`Target date: ${targetIso}`);
log(`Total input rows: ${allInputs.length}`);

const matched = [];
const skipped = [];

for (const item of allInputs) {
  const j = item.json || {};

  const rawDate = safeGet(j, ["AppointmentDate", "Datum", "Date"]);
  const isoDate = parseDateFlexible(rawDate);

  if (!isoDate) {
    skipped.push({ reason: "unparsable date", raw: rawDate, row: j._rowIndex });
    continue;
  }

  if (isoDate !== targetIso) continue;

  // Required fields for SMS sending
  const phone = normalizePhone(safeGet(j, ["CustomerPhone", "KundenTelefon"]));
  if (!phone) {
    skipped.push({ reason: "missing phone", row: j._rowIndex });
    continue;
  }

  matched.push({
    json: {
      ...j,
      _normalizedDate: isoDate,
      _normalizedPhone: phone,
      _displayName: truncateName(
        safeGet(j, ["CustomerName", "KundenName"], "Customer"),
      ),
    },
  });
}

log(`Matched: ${matched.length}, Skipped: ${skipped.length}`);
if (DEBUG && skipped.length) console.log("Skipped detail:", skipped);

return matched;
