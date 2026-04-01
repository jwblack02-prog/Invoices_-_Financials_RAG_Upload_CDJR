import { Pinecone, type Index } from "@pinecone-database/pinecone";
import type { EmbeddedChunk } from "./types.js";

const UPSERT_BATCH_SIZE = 100;

let pinecone: Pinecone | null = null;
let index: Index | null = null;

export function getPineconeIndex(): Index {
  if (index) return index;

  pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  index = pinecone.index(process.env.PINECONE_INDEX_NAME || "invoices-financials");
  return index;
}

export async function upsertVectors(
  idx: Index,
  embedded: EmbeddedChunk[]
): Promise<void> {
  for (let i = 0; i < embedded.length; i += UPSERT_BATCH_SIZE) {
    const batch = embedded.slice(i, i + UPSERT_BATCH_SIZE);

    await idx.upsert(
      batch.map((chunk) => ({
        id: chunk.id,
        values: chunk.embedding,
        metadata: chunk.metadata,
      }))
    );

    console.log(
      `Upserted ${Math.min(i + UPSERT_BATCH_SIZE, embedded.length)}/${embedded.length} vectors`
    );
  }
}

export async function checkIfProcessed(
  idx: Index,
  fileId: string,
  lastModified: string
): Promise<boolean> {
  try {
    // Query for any vector with this file ID and same lastModified
    const results = await idx.query({
      vector: new Array(parseInt(process.env.EMBEDDING_DIMENSIONS || "3072", 10)).fill(0),
      topK: 1,
      filter: {
        onedrive_file_id: { $eq: fileId },
        last_modified: { $eq: lastModified },
      },
      includeMetadata: true,
    });

    return (results.matches?.length || 0) > 0;
  } catch {
    // If query fails, assume not processed — safe to re-process
    return false;
  }
}

export async function deleteByFileId(
  idx: Index,
  fileId: string
): Promise<void> {
  try {
    await idx.deleteMany({
      filter: { onedrive_file_id: { $eq: fileId } },
    });
    console.log(`Deleted vectors for file ${fileId}`);
  } catch (error) {
    console.error(`Failed to delete vectors for file ${fileId}:`, error);
  }
}
