import { schedules, logger } from "@trigger.dev/sdk/v3";
import { getDelta, downloadFile } from "../lib/graphClient.js";
import { readDeltaToken, saveDeltaToken } from "../lib/deltaTracker.js";
import { extractAndChunk } from "../lib/pdfProcessor.js";
import { embedChunks } from "../lib/embedder.js";
import {
  getPineconeIndex,
  upsertVectors,
  checkIfProcessed,
  deleteByFileId,
} from "../lib/pineconeClient.js";

export const ingestOneDriveTask = schedules.task({
  id: "ingest-onedrive-pdfs",
  // Every Monday at 6 AM UTC
  cron: "0 6 * * 1",
  maxDuration: 300,
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 30_000,
  },

  run: async () => {
    const userId = process.env.ONEDRIVE_USER_ID!;
    const folderPath = process.env.ONEDRIVE_FOLDER_PATH!;
    const index = getPineconeIndex();

    // Step 1: Read delta token from Pinecone
    logger.info("Reading delta token...");
    let deltaToken = await readDeltaToken(index);
    const isFirstRun = !deltaToken;
    logger.info(isFirstRun ? "First run — full scan" : "Incremental scan with delta token");

    // Step 2: Call Graph delta API
    let deltaResponse;
    try {
      deltaResponse = await getDelta(userId, folderPath, deltaToken);
    } catch (error: any) {
      if (error.message === "DELTA_TOKEN_EXPIRED") {
        logger.warn("Delta token expired (410 Gone), doing full re-scan...");
        deltaResponse = await getDelta(userId, folderPath, null);
      } else {
        throw error;
      }
    }

    logger.info(`Delta returned ${deltaResponse.items.length} items`);

    // Step 3: Filter to PDF files only
    const pdfItems = deltaResponse.items.filter(
      (item) =>
        item.isFile &&
        item.name.toLowerCase().endsWith(".pdf") &&
        !item.deleted
    );

    const deletedItems = deltaResponse.items.filter(
      (item) => item.deleted && item.name.toLowerCase().endsWith(".pdf")
    );

    logger.info(
      `Found ${pdfItems.length} PDF(s) to process, ${deletedItems.length} deleted`
    );

    // Step 4: Handle deleted files — remove vectors
    for (const deleted of deletedItems) {
      logger.info(`Removing vectors for deleted file: ${deleted.name}`);
      await deleteByFileId(index, deleted.id);
    }

    // Step 5: Process each new/modified PDF
    let processedCount = 0;
    let skippedCount = 0;
    let totalChunks = 0;

    for (const item of pdfItems) {
      // 5a: Check if already processed with same lastModified
      const alreadyProcessed = await checkIfProcessed(
        index,
        item.id,
        item.lastModifiedDateTime
      );

      if (alreadyProcessed) {
        logger.info(`Skipping ${item.name} — already processed`);
        skippedCount++;
        continue;
      }

      logger.info(`Processing: ${item.name} (${(item.size / 1024).toFixed(1)} KB)`);

      // 5b: Download PDF
      const pdfBuffer = await downloadFile(userId, item.id);

      // 5c: Extract text and chunk
      const chunks = await extractAndChunk(
        pdfBuffer,
        item.id,
        item.name,
        item.parentPath,
        item.lastModifiedDateTime
      );

      if (chunks.length === 0) {
        logger.warn(`No text extracted from ${item.name}, skipping`);
        continue;
      }

      logger.info(`Extracted ${chunks.length} chunks from ${item.name}`);

      // 5d: Generate embeddings
      const embedded = await embedChunks(chunks);

      // 5e: Upsert to Pinecone
      await upsertVectors(index, embedded);

      processedCount++;
      totalChunks += chunks.length;
      logger.info(`Completed ${item.name}: ${chunks.length} vectors upserted`);
    }

    // Step 6: Save new delta token ONLY after all files succeed
    if (deltaResponse.deltaToken) {
      await saveDeltaToken(index, deltaResponse.deltaToken);
      logger.info("Delta token saved for next run");
    }

    // Step 7: Summary
    const summary = {
      firstRun: isFirstRun,
      totalItemsFromDelta: deltaResponse.items.length,
      pdfsProcessed: processedCount,
      pdfsSkipped: skippedCount,
      pdfsDeleted: deletedItems.length,
      totalChunksUpserted: totalChunks,
    };

    logger.info("Ingestion complete", summary);
    return summary;
  },
});
