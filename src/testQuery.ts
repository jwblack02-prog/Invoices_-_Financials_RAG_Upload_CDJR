/**
 * Local end-to-end test for the RAG query pipeline.
 * Mirrors the production hybrid search pipeline in queryRAG.ts.
 * Usage: npx tsx src/testQuery.ts "What have we spent on WI-Advisor since August 2025?"
 */
import "dotenv/config";
import { embedQuery } from "./lib/embedder.js";
import { getSupabaseClient, queryVectors, searchByText } from "./lib/supabaseClient.js";
import { generateAnswer } from "./lib/llm.js";
import { extractSignificantKeywords, filterAndRankChunks } from "./lib/queryFilter.js";

async function main() {
  const question = process.argv[2] || "What invoices were submitted recently?";

  console.log("=== RAG Query Test (Hybrid Pipeline) ===");
  console.log(`Question: ${question}\n`);

  // Step 1: Embed
  console.log("Embedding question...");
  const embedding = await embedQuery(question);
  console.log(`  Embedded (${embedding.length} dimensions)\n`);

  // Step 2: Vector search (same params as production)
  console.log("Vector search (topK=50, threshold>=0.20)...");
  const client = getSupabaseClient();
  const allMatches = await queryVectors(client, embedding, 50);
  const vectorMatches = allMatches.filter((m) => m.score >= 0.20);
  console.log(`  Vector matches: ${vectorMatches.length} of ${allMatches.length}\n`);

  // Step 3: FTS search with entity keywords only (mirrors production)
  const entityKeywords = extractSignificantKeywords(question);
  const ftsQuery = entityKeywords.length > 0 ? entityKeywords.join(" ") : question;
  console.log(`FTS search (query="${ftsQuery}", limit=30)...`);
  const ftsMatches = await searchByText(client, ftsQuery, 30);
  console.log(`  FTS matches: ${ftsMatches.length}\n`);

  // Step 4: Merge
  const seen = new Set<string>(vectorMatches.map((m) => m.id));
  const matches = [...vectorMatches];
  for (const m of ftsMatches) {
    if (!seen.has(m.id)) {
      matches.push(m);
      seen.add(m.id);
    }
  }
  console.log(`Combined: ${matches.length} chunks\n`);

  // Step 5: Keyword filter
  const keywords = extractSignificantKeywords(question);
  console.log(`Filter keywords: ${keywords.join(", ")}`);
  const filtered = filterAndRankChunks(matches, question, 30);
  console.log(`After filter: ${filtered.length} chunks retained\n`);

  // Show retained chunks
  console.log("=== Retained Chunks ===");
  for (const m of filtered) {
    console.log(
      `  [${m.score.toFixed(3)}] ${m.metadata.source_file} (chunk ${m.metadata.chunk_index}/${m.metadata.total_chunks})`
    );
    console.log(`    "${m.text.substring(0, 150)}..."\n`);
  }

  // Step 6: LLM
  console.log("Generating answer...");
  const answer = await generateAnswer(question, filtered);
  console.log(`\n=== Answer ===\n${answer}`);

  // Show sources
  const sourceFiles = [...new Set(filtered.map((m) => m.metadata.source_file))];
  console.log(`\n=== Sources (${sourceFiles.length} files) ===`);
  sourceFiles.forEach((f) => console.log(`  - ${f}`));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
