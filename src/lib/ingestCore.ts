import { logger } from "@trigger.dev/sdk/v3";
import { getDelta, downloadFile } from "./graphClient.js";
import { readDeltaToken, saveDeltaToken } from "./deltaTracker.js";
import { extractAndChunk } from "./pdfProcessor.js";
import { embedChunks } from "./embedder.js";
import {
  getSupabaseClient,
  upsertVectors,
  checkIfProcessed,
  deleteByFileId,
} from "./supabaseClient.js";

export interface IngestConfig {
  userId: string;
  folderPath: string;
  storeName: string;
}

export async function runIngestion(config: IngestConfig) {
  const { userId, folderPath, storeName } = config;
  const client = getSupabaseClient();

  // Step 1: Read delta token from Supabase
  logger.info(`[${storeName}] Reading delta token...`);
  let deltaToken = await readDeltaToken(client);
  const isFirstRun = !deltaToken;
  logger.info(
    isFirstRun
      ? `[${storeName}] First run — full scan`
      : `[${storeName}] Incremental scan with delta token`
  );

  // Step 2: Call Graph delta API
  let deltaResponse;
  try {
    deltaResponse = await getDelta(userId, folderPath, deltaToken);
  } catch (error: any) {
    if (error.message === "DELTA_TOKEN_EXPIRED") {
      logger.warn(`[${storeName}] Delta token expired (410 Gone), doing full re-scan...`);
      deltaResponse = await getDelta(userId, folderPath, null);
    } else {
      throw error;
    }
  }

  logger.info(`[${storeName}] Delta returned ${deltaResponse.items.length} items`);

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
    `[${storeName}] Found ${pdfItems.length} PDF(s) to process, ${deletedItems.length} deleted`
  );

  // Step 4: Handle deleted files — remove vectors
  for (const deleted of deletedItems) {
    logger.info(`[${storeName}] Removing vectors for deleted file: ${deleted.name}`);
    await deleteByFileId(client, deleted.id);
  }

  // Step 5: Process each new/modified PDF
  let processedCount = 0;
  let skippedCount = 0;
  let totalChunks = 0;

  for (const item of pdfItems) {
    const alreadyProcessed = await checkIfProcessed(
      client,
      item.id,
      item.lastModifiedDateTime
    );

    if (alreadyProcessed) {
      logger.info(`[${storeName}] Skipping ${item.name} — already processed`);
      skippedCount++;
      continue;
    }

    logger.info(
      `[${storeName}] Processing: ${item.name} (${(item.size / 1024).toFixed(1)} KB)`
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
      logger.warn(`[${storeName}] No text extracted from ${item.name}, skipping`);
      continue;
    }

    logger.info(`[${storeName}] Extracted ${chunks.length} chunks from ${item.name}`);

    const embedded = await embedChunks(chunks);
    await upsertVectors(client, embedded);

    processedCount++;
    totalChunks += chunks.length;
    logger.info(`[${storeName}] Completed ${item.name}: ${chunks.length} vectors upserted`);
  }

  // Step 6: Save new delta token ONLY after all files succeed
  if (deltaResponse.deltaToken) {
    await saveDeltaToken(client, deltaResponse.deltaToken);
    logger.info(`[${storeName}] Delta token saved for next run`);
  }

  // Step 7: Summary
  const summary = {
    store: storeName,
    firstRun: isFirstRun,
    totalItemsFromDelta: deltaResponse.items.length,
    pdfsProcessed: processedCount,
    pdfsSkipped: skippedCount,
    pdfsDeleted: deletedItems.length,
    totalChunksUpserted: totalChunks,
  };

  logger.info(`[${storeName}] Ingestion complete`, summary);
  return summary;
}
