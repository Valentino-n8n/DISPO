/**
 * Email HTML Body Stripper
 * ========================
 *
 * Microsoft Outlook / Microsoft Graph email triggers return the email body
 * as HTML by default. For LLM parsing, conditional matching, or text
 * search, the HTML wrapping (style tags, nested tables, &nbsp;, multiple
 * line breaks) needs to be stripped to plain text.
 *
 * Used in: n8n Code node, after the Outlook trigger.
 *
 * Input:  { body: { content: '<html>...</html>' }, ...other fields }
 * Output: { ...input, cleanedBody: 'plain text version' }
 */

const htmlContent = $input.first().json.body.content;

const plainText = htmlContent
  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "") // drop style blocks
  .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "") // drop scripts
  .replace(/<[^>]+>/g, "\n")                       // tags → newlines
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/\r\n|\r|\n/g, "\n")
  .replace(/\n{3,}/g, "\n\n")                      // collapse blank lines
  .trim();

return [
  {
    json: {
      ...$input.first().json,
      cleanedBody: plainText,
    },
  },
];