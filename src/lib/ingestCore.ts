import { logger } from "@trigger.dev/sdk/v3";
import { getDelta, downloadFile } from "./graphClient.js";
import { readDeltaToken, saveDeltaToken } from "./deltaTracker.js";
import { extractAndChunk } from "./pdfProcessor.js";
import { embedChunks } from "./embedder.js";
import {
  getPineconeIndex,
  upsertVectors,
  checkIfProcessed,
  deleteByFileId,
} from "./pineconeClient.js";

export interface IngestConfig {
  userId: string;
  folderPath: string;
  indexName: string;
}

export async function runIngestion(config: IngestConfig) {
  const { userId, folderPath, indexName } = config;
  const index = getPineconeIndex(indexName);

  // Step 1: Read delta token from Pinecone
  logger.info(`[${indexName}] Reading delta token...`);
  let deltaToken = await readDeltaToken(index);
  const isFirstRun = !deltaToken;
  logger.info(
    isFirstRun
      ? `[${indexName}] First run — full scan`
      : `[${indexName}] Incremental scan with delta token`
  );

  // Step 2: Call Graph delta API
  let deltaResponse;
  try {
    deltaResponse = await getDelta(userId, folderPath, deltaToken);
  } catch (error: any) {
    if (error.message === "DELTA_TOKEN_EXPIRED") {
      logger.warn(`[${indexName}] Delta token expired (410 Gone), doing full re-scan...`);
      deltaResponse = await getDelta(userId, folderPath, null);
    } else {
      throw error;
    }
  }

  logger.info(`[${indexName}] Delta returned ${deltaResponse.items.length} items`);

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
    `[${indexName}] Found ${pdfItems.length} PDF(s) to process, ${deletedItems.length} deleted`
  );

  // Step 4: Handle deleted files — remove vectors
  for (const deleted of deletedItems) {
    logger.info(`[${indexName}] Removing vectors for deleted file: ${deleted.name}`);
    await deleteByFileId(index, deleted.id);
  }

  // Step 5: Process each new/modified PDF
  let processedCount = 0;
  let skippedCount = 0;
  let totalChunks = 0;

  for (const item of pdfItems) {
    const alreadyProcessed = await checkIfProcessed(
      index,
      item.id,
      item.lastModifiedDateTime
    );

    if (alreadyProcessed) {
      logger.info(`[${indexName}] Skipping ${item.name} — already processed`);
      skippedCount++;
      continue;
    }

    logger.info(
      `[${indexName}] Processing: ${item.name} (${(item.size / 1024).toFixed(1)} KB)`
    );

    const pdfBuffer = await downloadFile(userId, item.id);

    const chunks = await extractAndChunk(
      pdfBuffer,
      item.id,
      item.name,
      item.parentPath,
      item.lastModifiedDateTime
    );

    if (chunks.length === 0) {
      logger.warn(`[${indexName}] No text extracted from ${item.name}, skipping`);
      continue;
    }

    logger.info(`[${indexName}] Extracted ${chunks.length} chunks from ${item.name}`);

    const embedded = await embedChunks(chunks);
    await upsertVectors(index, embedded);

    processedCount++;
    totalChunks += chunks.length;
    logger.info(`[${indexName}] Completed ${item.name}: ${chunks.length} vectors upserted`);
  }

  // Step 6: Save new delta token ONLY after all files succeed
  if (deltaResponse.deltaToken) {
    await saveDeltaToken(index, deltaResponse.deltaToken);
    logger.info(`[${indexName}] Delta token saved for next run`);
  }

  // Step 7: Summary
  const summary = {
    store: indexName,
    firstRun: isFirstRun,
    totalItemsFromDelta: deltaResponse.items.length,
    pdfsProcessed: processedCount,
    pdfsSkipped: skippedCount,
    pdfsDeleted: deletedItems.length,
    totalChunksUpserted: totalChunks,
  };

  logger.info(`[${indexName}] Ingestion complete`, summary);
  return summary;
}
