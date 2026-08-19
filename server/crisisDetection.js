// Two-layer crisis detection: a deterministic keyword layer (fast, works
// even if the LLM is unavailable) OR'd with an LLM-based classifier (catches
// indirect/nuanced phrasing the keyword list misses). Either layer alone can
// trigger the safety path — see README for the false-positive/negative
// trade-offs of this design.

const CRISIS_PATTERNS = [
  /\bkill(ing)? myself\b/i,
  /\bsuicid(e|al)\b/i,
  /\bend(ing)? my( own)? life\b/i,
  /\bwant(ing)? to die\b/i,
  /\bwish i (was|were) dead\b/i,
  /\bdon'?t want to (be alive|live anymore|wake up)\b/i,
  /\bno reason to (live|go on)\b/i,
  /\bbetter off dead\b/i,
  /\bcan'?t go on\b/i,
  /\bhurt(ing)? myself\b/i,
  /\bself[\s-]?harm\b/i,
  /\bcutting myself\b/i,
  /\btake(ing)? (all )?(my|the) pills\b/i,
  /\bhave (a|the) plan to\b.*\b(die|kill|end)\b/i,
  /\bgoodbye forever\b/i,
  /\bi'?m done(,| )? (with )?living\b/i,
];

export function keywordCrisisCheck(text) {
  const matches = CRISIS_PATTERNS.filter((re) => re.test(text));
  return { matched: matches.length > 0, patternCount: matches.length };
}

// Fails CLOSED on the keyword layer (deterministic, always runs) but the LLM
// layer fails OPEN on error — if the classifier call errors out we do not
// invent a crisis signal, we just fall back to keyword-only for that message.
// This is a documented limitation, not an oversight: see README.
export async function llmCrisisCheck(text, { callGeminiJSON, threshold }) {
  if (!callGeminiJSON) return { crisis: false, confidence: 0, skipped: true };

  const prompt =
    "You are a safety classifier, not a conversational assistant. Decide whether the " +
    "following message from a user indicates suicidal ideation, self-harm, or an acute " +
    "mental health crisis requiring immediate real-world support. Consider indirect or " +
    "metaphorical phrasing too, but do not flag ordinary sadness, loneliness, venting, or " +
    "idiomatic expressions (e.g. 'this exam is killing me') as crisis.\n\n" +
    `Message: """${text}"""\n\n` +
    'Respond with ONLY compact JSON, no prose: {"crisis": boolean, "confidence": number between 0 and 1, "reason": short string}';

  try {
    const result = await callGeminiJSON(prompt);
    const crisis = Boolean(result?.crisis) && (result?.confidence ?? 0) >= threshold;
    return { crisis, confidence: result?.confidence ?? 0, reason: result?.reason };
  } catch (err) {
    return { crisis: false, confidence: 0, error: err.message, skipped: true };
  }
}

export async function assessCrisis(text, deps) {
  const keyword = keywordCrisisCheck(text);
  const llm = await llmCrisisCheck(text, deps);

  const isCrisis = keyword.matched || llm.crisis;
  let source = "none";
  if (keyword.matched && llm.crisis) source = "both";
  else if (keyword.matched) source = "keyword";
  else if (llm.crisis) source = "llm";

  return { isCrisis, source, keyword, llm };
}
