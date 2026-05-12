# Code Node Snippets

JavaScript helpers extracted from production n8n Code nodes. Each file
is self-contained, generalized, and includes inline documentation
explaining when and why to use it.

| File | Purpose |
|---|---|
| `llm-output-sanitizer.js` | Clean and validate structured output from an LLM agent before it enters downstream nodes. |
| `email-html-stripper.js` | Convert Microsoft Outlook HTML email body to plain text. |
| `batch-deduplication.js` | Process unique keys in a SplitInBatches loop while suppressing duplicate side effects. |
| `data-shape-transformer.js` | Map raw spreadsheet columns to a clean, normalized shape with validation. |
| `binary-attachment-extractor.js` | Fan out email attachments into one item per file for downstream upload. |
| `appointment-date-filter.js` | Robust "find appointments scheduled for tomorrow" filter that handles mixed date formats from Excel. |
| `docusign-envelope-extractor.js` | Parse a DocuSign envelope UUID from a notification email body, with multi-strategy fallback. |
| `folder-path-sanitizer.js` | Generate safe SharePoint / OneDrive folder and file names from customer-supplied data. |
| `scheduled-summary-aggregator.js` | Daily summary pattern: count today's actions, count tomorrow's pending items, count overdue items, format Slack message. |

## How to use

In n8n: drop a **Code** node, paste the contents, adjust field names
to match your data shape, connect it where the doc-comment indicates.

Each snippet assumes the standard n8n Code-node context (`$input`,
`$json`, `items`, `$()`).
