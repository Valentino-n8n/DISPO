/**
 * Data Shape Transformer
 * ======================
 *
 * Takes raw rows from a spreadsheet (Microsoft Excel via Microsoft Graph)
 * with German operational column names and emits a clean, normalized
 * shape ready for downstream nodes (DocuSign, SMS, Slack).
 *
 * Why a separate transformer node:
 * - Spreadsheet column names change as the operations team renames things;
 *   this node is the only place that touches German→English naming, so
 *   downstream logic stays stable.
 * - Trims whitespace and strips HTML inserted by mobile email clients.
 * - Provides a single point of failure (and a single point to log) when
 *   data shape changes upstream.
 *
 * Input columns (raw):  KundenName, KundenAdresse, KundenTelefon,
 *                       KundenEmail, ProjektleiterName, ProjektleiterEmail,
 *                       ProjektleiterFirma, BookingID, Datum, Uhrzeit
 * Output: clean, snake-case, English-named fields.
 */

// Try the standard input first; fall back to a known upstream node when
// the loop's previous step produced no output (e.g. all rows filtered).
let items;
if ($input.all().length === 0) {
  items = $("Separate the date and time").all();
} else {
  items = $input.all();
}

return items.map((item) => {
  const raw = item.json;

  const clean = (str) => {
    if (typeof str !== "string") return str;
    return str
      .replace(/<[^>]*>/g, "") // strip any inline HTML
      .replace(/[\n\r\t]+/g, " ") // flatten line breaks
      .replace(/\s+/g, " ") // collapse multiple spaces
      .trim();
  };

  const data = {
    bookingId: clean(raw.BookingID || ""),
    customerName: clean(raw.KundenName || ""),
    customerAddress: clean(raw.KundenAdresse || ""),
    customerPhone: clean(raw.KundenTelefon || ""),
    customerEmail: clean(raw.KundenEmail || ""),
    projectManager: clean(raw.ProjektleiterName || ""),
    projectManagerEmail: clean(raw.ProjektleiterEmail || ""),
    company: clean(raw.ProjektleiterFirma || ""),
    appointmentDate: clean(raw.Datum || ""),
    appointmentTime: clean(raw.Uhrzeit || ""),
    rowIndex: raw._rowIndex,
  };

  // Validation: throw early if a critical field is missing so the workflow
  // surfaces the bad row in the n8n execution log instead of silently
  // writing garbage downstream.
  if (!data.bookingId) {
    throw new Error(
      `Row ${data.rowIndex}: missing BookingID — cannot proceed.`,
    );
  }

  return { json: data };
});