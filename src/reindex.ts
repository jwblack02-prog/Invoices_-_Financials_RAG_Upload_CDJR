/**
 * One-off re-indexing script. Clears the Pinecone index and re-ingests
 * all PDFs with text stored in metadata (needed for query workflow).
 * Usage: npx tsx src/reindex.ts
 */
import "dotenv/config";
import { getPineconeIndex } from "./lib/pineconeClient.js";

async function main() {
  const indexName = process.env.PINECONE_INDEX_NAME || "invoices-financials-cdjr";
  console.log(`Clearing index: ${indexName}`);

  const index = getPineconeIndex(indexName);
  await index.deleteAll();
  console.log("Index cleared. Now run: npx tsx src/testLocal.ts");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
