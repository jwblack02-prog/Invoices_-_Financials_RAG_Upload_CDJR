import type { QueryMatch } from "./types.js";

const STOP_WORDS = new Set([
  // English common
  "what", "have", "has", "we", "the", "a", "an", "is", "are", "was", "were",
  "been", "be", "do", "does", "did", "will", "would", "could", "should",
  "can", "may", "might", "shall", "must", "need", "how", "much", "many",
  "when", "where", "which", "who", "whom", "that", "this", "these", "those",
  "and", "but", "or", "not", "no", "nor", "for", "with", "from", "by",
  "at", "to", "in", "on", "of", "up", "out", "off", "over", "into",
  "about", "our", "us", "i", "me", "my", "your", "you", "he", "she",
  "it", "its", "they", "them", "their", "all", "any", "each", "every",
  // Financial query words
  "spent", "spend", "spending", "paid", "pay", "paying", "cost", "costs",
  "charge", "charges", "charged", "invoice", "invoices", "bill", "bills",
  "total", "amount", "since", "between", "during", "before", "after",
  "through", "until", "show", "tell", "list", "give", "find", "get",
  "been", "being", "also", "just", "than", "then", "some", "like",
]);

const MONTH_NAMES = new Set([
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
]);

export function extractSignificantKeywords(question: string): string[] {
  const words = question
    .toLowerCase()
    .replace(/-/g, "")       // "WI-Advisor" → "wiadvisor"
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);

  const significant = words.filter(
    (w) =>
      !STOP_WORDS.has(w) &&
      !MONTH_NAMES.has(w) &&
      w.length > 2 &&
      !/^\d+$/.test(w) // exclude pure numbers (years, amounts)
  );

  // Fallback: if everything was filtered, use any word > 2 chars
  return significant.length > 0 ? significant : words.filter((w) => w.length > 2);
}

export function filterAndRankChunks(
  matches: QueryMatch[],
  question: string,
  maxChunks = 30
): QueryMatch[] {
  const keywords = extractSignificantKeywords(question);

  let filtered = matches;
  if (keywords.length > 0) {
    filtered = matches.filter((m) => {
      const lowerText = m.text.toLowerCase().replace(/-/g, "");
      const lowerFile = (m.metadata?.source_file || "").toLowerCase().replace(/-/g, "");
      return keywords.some((kw) => lowerText.includes(kw) || lowerFile.includes(kw));
    });

    // Fallback: if filtering removed everything, keep originals
    if (filtered.length === 0) {
      filtered = matches;
    }
  }

  // Sort chronologically by last_modified
  filtered.sort((a, b) => {
    const dateA = a.metadata?.last_modified || "";
    const dateB = b.metadata?.last_modified || "";
    return dateA.localeCompare(dateB);
  });

  return filtered.slice(0, maxChunks);
}
