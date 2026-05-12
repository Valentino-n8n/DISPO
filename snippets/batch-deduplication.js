/**
 * Batch Deduplication via Loop Context
 * ====================================
 *
 * Pattern for processing rows in a SplitInBatches loop while ensuring that
 * downstream side effects (e.g. emails to a project manager, Slack DMs)
 * happen ONLY ONCE per unique key, even if the input contains duplicates.
 *
 * In a multi-region dispatch system, a single PM may own multiple bookings
 * in the same batch — we still want one summary email, not five.
 *
 * Approach:
 * - First Code node: tag each item with a stable key (e.g. PM email + name).
 * - Loop Over Items (SplitInBatches) iterates one item at a time.
 * - Second Code node inside the loop: read processedKeys from loop context,
 *   skip if already seen, otherwise add and continue.
 *
 * Used in: n8n Code nodes around a SplitInBatches loop.
 */

// ───────────────────────────────────────────────────────────────────
// Step 1 — Tag each input row with a unique key.
// Place BEFORE the Loop Over Items node.
// ───────────────────────────────────────────────────────────────────
return items.map((item) => {
  return {
    json: {
      ...item.json,
      _pmKey: `${item.json.projectManagerEmail}_${item.json.projectManagerName}`,
    },
  };
});

// ───────────────────────────────────────────────────────────────────
// Step 2 — Inside the loop, mark keys as processed.
// Place AFTER the loop input, BEFORE the side-effect node (email / Slack).
// Use this in conjunction with an IF node that checks
// `{{ $('Loop Over Items').context.processedPMs.includes($json._pmKey) }}`
// to skip duplicates.
// ───────────────────────────────────────────────────────────────────
const processedPMs = $input.item.json.processedPMs || [];

if (!processedPMs.includes($input.item.json._pmKey)) {
  processedPMs.push($input.item.json._pmKey);
}

// Persist back into the loop's context so the next iteration can see it.
$("Loop Over Items").context["processedPMs"] = processedPMs;

return {
  json: {
    ...$input.item.json,
    processedPMs: processedPMs,
  },
};