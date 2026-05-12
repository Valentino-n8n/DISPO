/**
 * Email Binary Attachment Extractor
 * =================================
 *
 * When an email arrives via Microsoft Outlook trigger with attachments
 * (PDFs, images, Excel), n8n exposes them under `items[i].binary`. This
 * Code node fans them out into one item per attachment, attaching the
 * destination folder ID from a previous "Create folder" step so each
 * file can be uploaded to the correct customer folder.
 *
 * Used in: n8n Code node, after a Merge that combines email-trigger
 * output with a "Create folder" output.
 *
 * Input:  one item with multiple binary keys + folder ID in JSON
 * Output: N items, one per attachment, ready for OneDrive/SharePoint upload.
 */

const attachments = [];
const emailData = items[0].json;
const binaryData = items[0].binary;

// The folder ID arrives via merge from the "Create a folder" branch.
const folderId =
  items[0].json.id || $("Create a folder").first().json.id;

if (binaryData) {
  const attachmentKeys = Object.keys(binaryData);

  attachmentKeys.forEach((key) => {
    attachments.push({
      json: {
        attachmentName: binaryData[key].fileName || key,
        mimeType: binaryData[key].mimeType || "application/octet-stream",
        fileSize: binaryData[key].data
          ? Buffer.byteLength(binaryData[key].data, "base64")
          : 0,
        folderId: folderId,
        bookingId: emailData.bookingId,
        customerName: emailData.customerName,
      },
      binary: {
        // Keep the binary under the canonical key 'data' so the next
        // upload node doesn't need per-attachment configuration.
        data: binaryData[key],
      },
    });
  });
}

if (attachments.length === 0) {
  // Don't throw — just emit a marker item so the workflow continues but
  // the absence is visible in execution history.
  return [
    {
      json: {
        attachmentName: null,
        message: "No attachments on this email",
        bookingId: emailData.bookingId,
      },
    },
  ];
}

return attachments;