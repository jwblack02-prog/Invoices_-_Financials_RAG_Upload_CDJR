import { schedules } from "@trigger.dev/sdk/v3";
import { runIngestion } from "../lib/ingestCore.js";

// ============================================================
// CDJR Store — Scheduled (weekly Monday 6 AM UTC)
// ============================================================
export const ingestCDJRScheduled = schedules.task({
  id: "ingest-cdjr-weekly",
  cron: "0 6 * * 1",
  maxDuration: 300,
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 30_000,
  },

  run: async () => {
    return runIngestion({
      userId: process.env.ONEDRIVE_USER_ID!,
      folderPath: process.env.ONEDRIVE_FOLDER_PATH!,
      indexName: process.env.PINECONE_INDEX_NAME || "invoices-financials-cdjr",
    });
  },
});
