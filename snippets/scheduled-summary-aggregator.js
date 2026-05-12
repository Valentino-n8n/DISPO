/**
 * Scheduled Daily Summary Aggregator
 * ==================================
 *
 * Runs once per day on a schedule trigger. Reads two sheets — a "logged
 * actions" sheet and a "tracking / status" sheet — and produces a single
 * Slack-ready summary message:
 *
 *   - How many actions of a given type fired today
 *   - How many appointments are scheduled for tomorrow with unresolved status
 *   - How many items have been waiting for resolution longer than N days
 *
 * Pattern highlights:
 *   - Date comparison done in two passes: parse to a normalized form,
 *     then compare. Spreadsheet date columns are notoriously inconsistent.
 *   - Counters are accumulated, then formatted into a single message at
 *     the end. The Slack node receives one item with the message body
 *     ready to send — no string-building inside the Slack node.
 *   - Empty result handling: if there's nothing to report, we still emit
 *     a summary saying "0 today, 0 overdue" so the operator knows the
 *     workflow ran rather than wondering if it broke silently.
 *
 * Used in: n8n Code node, after the workflow has fanned out, read both
 * sheets, and merged them back together.
 *
 * Output: a single item with a `message` field, ready for the Slack
 * "Send Message" node.
 */

const TYPE_TO_COUNT = "REMINDER_SMS"; // adjust to your action type
const OVERDUE_THRESHOLD_DAYS = 2;

// ---------- helpers ----------

function parseGermanOrIso(s) {
  if (!s) return null;
  const str = String(s).trim();
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(str);
  if (de) {
    const [, dd, mm, yyyy] = de;
    return new Date(`${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`);
  }
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function daysBetween(later, earlier) {
  const ms = later.getTime() - earlier.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function formatDateGerman(d) {
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ---------- main ----------

// Pull both source sheets via $('NodeName').all()
const actionRows = $("Read Actions Log").all();
const trackingRows = $("Read Status Tracking").all();

const today = new Date();
today.setHours(0, 0, 0, 0);

const tomorrow = new Date(today);
tomorrow.setDate(tomorrow.getDate() + 1);

const overdueCutoff = new Date(today);
overdueCutoff.setDate(overdueCutoff.getDate() - OVERDUE_THRESHOLD_DAYS);

// ----- count today's logged actions -----
let todayCount = 0;
for (const item of actionRows) {
  const r = item.json;
  if (String(r.ActionType).trim() !== TYPE_TO_COUNT) continue;
  const sentAt = parseGermanOrIso(r.SentAt);
  if (sentAt && isSameDay(sentAt, today)) todayCount++;
}

// ----- count tomorrow's appointments with unresolved status -----
let tomorrowAppointments = 0;
for (const item of trackingRows) {
  const r = item.json;
  const apptDate = parseGermanOrIso(r.AppointmentDate);
  const status = String(r.Status || "").trim().toUpperCase();
  if (apptDate && isSameDay(apptDate, tomorrow) && status !== "RESOLVED") {
    tomorrowAppointments++;
  }
}

// ----- count overdue (sent > N days ago, never resolved) -----
let overdueCount = 0;
for (const item of trackingRows) {
  const r = item.json;
  const sentAt = parseGermanOrIso(r.SentAt);
  const status = String(r.Status || "").trim().toUpperCase();
  if (sentAt && sentAt < overdueCutoff && status === "PENDING") {
    overdueCount++;
  }
}

// ----- build message -----
const parts = [
  `📊 *Daily Summary — ${formatDateGerman(today)}*`,
  ``,
  `• ${todayCount} ${TYPE_TO_COUNT.toLowerCase().replace(
    /_/g,
    " ",
  )} action(s) today`,
  `• ${tomorrowAppointments} appointment(s) tomorrow with unresolved status`,
  `• ${overdueCount} item(s) overdue (sent > ${OVERDUE_THRESHOLD_DAYS} days ago, still pending)`,
];

return {
  json: {
    message: parts.join("\n"),
    counts: {
      today: todayCount,
      tomorrow: tomorrowAppointments,
      overdue: overdueCount,
    },
  },
};
