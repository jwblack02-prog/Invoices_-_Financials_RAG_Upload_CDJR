/**
 * Local end-to-end test — runs the full ingestion pipeline outside Trigger.dev.
 * Usage: npx tsx src/testLocal.ts
 */
import "dotenv/config";
import { getDelta, downloadFile } from "./lib/graphClient.js";
import { extractAndChunk } from "./lib/pdfProcessor.js";
import { embedChunks } from "./lib/embedder.js";
import {
  getPineconeIndex,
  upsertVectors,
  checkIfProcessed,
} from "./lib/pineconeClient.js";
import { readDeltaToken, saveDeltaToken } from "./lib/deltaTracker.js";

async function main() {
  const userId = process.env.ONEDRIVE_USER_ID!;
  const folderPath = process.env.ONEDRIVE_FOLDER_PATH!;
  const indexName = process.env.PINECONE_INDEX_NAME || "invoices-financials-cdjr";

  console.log("=== Local Ingestion Test ===");
  console.log(`User: ${userId}`);
  console.log(`Folder: ${folderPath}`);
  console.log(`Index: ${indexName}`);

  // Step 1: Delta token
  const index = getPineconeIndex(indexName);
  let deltaToken = await readDeltaToken(index);
  console.log(deltaToken ? "Resuming with delta token" : "First run — full scan");

  // Step 2: Graph delta
  let deltaResponse;
  try {
    deltaResponse = await getDelta(userId, folderPath, deltaToken);
  } catch (error: any) {
    if (error.message === "DELTA_TOKEN_EXPIRED") {
      console.log("Delta token expired, doing full scan...");
      deltaResponse = await getDelta(userId, folderPath, null);
    } else {
      throw error;
    }
  }

  console.log(`Delta returned ${deltaResponse.items.length} items`);

  // Step 3: Filter PDFs
  const pdfItems = deltaResponse.items.filter(
    (item) => item.isFile && item.name.toLowerCase().endsWith(".pdf") && !item.deleted
  );
  console.log(`Found ${pdfItems.length} PDF(s)`);

  if (pdfItems.length === 0) {
    console.log("No PDFs to process. Saving delta token and exiting.");
    if (deltaResponse.deltaToken) {
      await saveDeltaToken(index, deltaResponse.deltaToken);
    }
    return;
  }

  // Step 4: Process each PDF
  let processedCount = 0;
  let totalChunks = 0;

  for (const item of pdfItems) {
    const alreadyProcessed = await checkIfProcessed(
      index,
      item.id,
      item.lastModifiedDateTime
    );

    if (alreadyProcessed) {
      console.log(`Skipping ${item.name} — already processed`);
      continue;
    }

    console.log(`Processing: ${item.name} (${(item.size / 1024).toFixed(1)} KB)`);

    const pdfBuffer = await downloadFile(userId, item.id);
    console.log(`  Downloaded ${pdfBuffer.length} bytes`);

    const chunks = await extractAndChunk(
      pdfBuffer,
      item.id,
      item.name,
      item.parentPath,
      item.lastModifiedDateTime
    );

    if (chunks.length === 0) {
      console.log(`  No text extracted from ${item.name}, skipping`);
      continue;
    }

    console.log(`  Extracted ${chunks.length} chunks`);
    // Show a preview of first chunk
    console.log(`  First chunk preview: "${chunks[0].text.substring(0, 100)}..."`);

    const embedded = await embedChunks(chunks);
    console.log(`  Embedded ${embedded.length} chunks`);

    await upsertVectors(index, embedded);
    console.log(`  Upserted ${embedded.length} vectors`);

    processedCount++;
    totalChunks += chunks.length;
  }

  // Step 5: Save delta token
  if (deltaResponse.deltaToken) {
    await saveDeltaToken(index, deltaResponse.deltaToken);
    console.log("Delta token saved");
  }

  console.log("\n=== Summary ===");
  console.log(`PDFs processed: ${processedCount}`);
  console.log(`Total chunks upserted: ${totalChunks}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
