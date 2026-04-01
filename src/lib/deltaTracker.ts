import type { Index } from "@pinecone-database/pinecone";

const SENTINEL_ID = "__delta_token__";
const EMBEDDING_DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS || "3072", 10);

function zeroVector(): number[] {
  return new Array(EMBEDDING_DIMENSIONS).fill(0);
}

export async function readDeltaToken(index: Index): Promise<string | null> {
  try {
    const result = await index.fetch([SENTINEL_ID]);
    const record = result.records[SENTINEL_ID];
    if (record?.metadata?.delta_token) {
      return record.metadata.delta_token as string;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveDeltaToken(
  index: Index,
  token: string
): Promise<void> {
  await index.upsert([
    {
      id: SENTINEL_ID,
      values: zeroVector(),
      metadata: {
        delta_token: token,
        updated_at: new Date().toISOString(),
        _type: "sentinel",
      },
    },
  ]);
}
