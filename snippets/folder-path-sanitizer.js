/**
 * Folder & File Name Sanitizer
 * ============================
 *
 * Generates safe SharePoint / OneDrive folder paths and file names from
 * customer-supplied data. SharePoint and Windows file systems reject a
 * specific set of characters, can silently truncate long Unicode strings,
 * and behave differently when names contain trailing whitespace or dots.
 *
 * This is the kind of code that looks trivial until a customer named
 * something like "Müller / Mayer-GmbH (2025)" silently breaks the upload
 * step at 3am.
 *
 * Used in: n8n Code node, before any "Create folder" / "Upload file"
 * action against Microsoft Graph.
 *
 * Output: { folderName, fileName, fullPath, subFolder } — ready to drop
 * into the next HTTP/Graph node.
 */

// ---------- helpers ----------

function sanitizePath(s) {
  // Characters illegal in Windows / SharePoint paths
  return String(s || "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, ""); // trailing dots/spaces are quietly stripped by Windows
}

function safeFileName(s, maxLen = 80) {
  // Keep letters (any language), digits, underscore/dot/hyphen/space.
  // \p{L} = any kind of letter (handles ä, ö, ü, ß, Cyrillic, etc.)
  return String(s || "")
    .replace(/[^\p{L}\d _.-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

/**
 * Categorize the service type into a top-level subfolder.
 * Order matters: most specific first, since substrings of broader
 * categories (e.g. "moving" vs "moving + assembly") overlap.
 */
function getSubFolder(serviceType) {
  const text = String(serviceType || "").trim().toLowerCase();
  if (!text) return "Other";

  const categories = [
    { folder: "Disassembly", match: ["disassembly", "demontage"] },
    { folder: "Reassembly", match: ["reassembly", "remontage"] },
    { folder: "Assembly", match: ["assembly", "montage", "installation"] },
    { folder: "Moving", match: ["moving", "umzug", "relocation"] },
    { folder: "Cleaning", match: ["cleaning", "reinigung"] },
  ];

  for (const cat of categories) {
    if (cat.match.some((kw) => text.includes(kw))) return cat.folder;
  }
  return "Other";
}

// ---------- main ----------

const row = $json;

const customerName = sanitizePath(row.customerName || "Unknown_Customer");
const bookingId = sanitizePath(row.bookingId || "no-id");
const serviceType = row.serviceType || "";

const subFolder = getSubFolder(serviceType);

// e.g. "MUELLER_GMBH__SRL-1042"
const folderName = sanitizePath(`${customerName}__${bookingId}`);

// e.g. "Liability_Cert_MUELLER_GMBH_SRL-1042.pdf"
const fileName = safeFileName(`${row.documentType}_${folderName}.pdf`);

// e.g. "Disassembly/MUELLER_GMBH__SRL-1042/Liability_Cert_*.pdf"
const fullPath = `${subFolder}/${folderName}/${fileName}`;

return {
  json: {
    ...row,
    folderName,
    fileName,
    fullPath,
    subFolder,
  },
};
