/**
 * Local end-to-end test for the RAG query pipeline.
 * Usage: npx tsx src/testQuery.ts "What invoices were submitted in March?"
 */
import "dotenv/config";
import { embedQuery } from "./lib/embedder.js";
import { getPineconeIndex, queryVectors } from "./lib/pineconeClient.js";
import { generateAnswer } from "./lib/llm.js";

async function main() {
  const question = process.argv[2] || "What invoices were submitted recently?";

  console.log("=== RAG Query Test ===");
  console.log(`Question: ${question}\n`);

  // Step 1: Embed the question
  console.log("Embedding question...");
  const embedding = await embedQuery(question);
  console.log(`  Embedded (${embedding.length} dimensions)\n`);

  // Step 2: Query Pinecone
  console.log("Querying Pinecone...");
  const index = getPineconeIndex();
  const matches = await queryVectors(index, embedding, 5);
  console.log(`  Found ${matches.length} matches:\n`);

  for (const match of matches) {
    console.log(`  [${match.score.toFixed(3)}] ${match.metadata.source_file} (chunk ${match.metadata.chunk_index}/${match.metadata.total_chunks})`);
    console.log(`    "${match.text.substring(0, 120)}..."\n`);
  }

  // Step 3: Generate answer
  console.log("Generating answer...");
  const answer = await generateAnswer(question, matches);
  console.log(`\n=== Answer ===\n${answer}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
