import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { EmbeddedChunk, QueryMatch } from "./types.js";

const UPSERT_BATCH_SIZE = 100;

let supabase: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return supabase;
}

export async function upsertVectors(
  client: SupabaseClient,
  embedded: EmbeddedChunk[]
): Promise<void> {
  for (let i = 0; i < embedded.length; i += UPSERT_BATCH_SIZE) {
    const batch = embedded.slice(i, i + UPSERT_BATCH_SIZE);

    const rows = batch.map((chunk) => ({
      id: chunk.id,
      embedding: `[${chunk.embedding.join(",")}]`,
      text: chunk.text,
      source_file: chunk.metadata.source_file,
      onedrive_file_id: chunk.metadata.onedrive_file_id,
      folder_path: chunk.metadata.folder_path,
      chunk_index: chunk.metadata.chunk_index,
      total_chunks: chunk.metadata.total_chunks,
      last_modified: chunk.metadata.last_modified,
    }));

    const { error } = await client
      .from("document_chunks")
      .upsert(rows, { onConflict: "id" });

    if (error) throw new Error(`Supabase upsert failed: ${error.message}`);

    console.log(
      `Upserted ${Math.min(i + UPSERT_BATCH_SIZE, embedded.length)}/${embedded.length} vectors`
    );
  }
}

export async function checkIfProcessed(
  client: SupabaseClient,
  fileId: string,
  lastModified: string
): Promise<boolean> {
  try {
    const { data, error } = await client
      .from("document_chunks")
      .select("id")
      .eq("onedrive_file_id", fileId)
      .eq("last_modified", lastModified)
      .limit(1);

    if (error) return false;
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function queryVectors(
  client: SupabaseClient,
  embedding: number[],
  topK = 5
): Promise<QueryMatch[]> {
  const { data, error } = await client.rpc("match_documents", {
    query_embedding: `[${embedding.join(",")}]`,
    match_count: topK,
  });

  if (error) throw new Error(`Supabase query failed: ${error.message}`);

  return (data || []).map((row: any) => ({
    id: row.id,
    score: row.score,
    text: row.text,
    metadata: row.metadata || {},
  }));
}

export async function deleteByFileId(
  client: SupabaseClient,
  fileId: string
): Promise<void> {
  try {
    const { error } = await client
      .from("document_chunks")
      .delete()
      .eq("onedrive_file_id", fileId);

    if (error) throw error;
    console.log(`Deleted vectors for file ${fileId}`);
  } catch (error) {
    console.error(`Failed to delete vectors for file ${fileId}:`, error);
  }
}
