/**
 * Verifies that the required Supabase tables exist and prints row counts.
 * Run this after applying the SQL migration in the Supabase SQL Editor.
 *
 * Usage: npx tsx scripts/createSupabaseTables.ts
 *
 * ─── SQL to run in Supabase SQL Editor first ───────────────────────────────
 *
 * CREATE EXTENSION IF NOT EXISTS vector;
 *
 * CREATE TABLE document_chunks (
 *   id TEXT PRIMARY KEY,
 *   embedding VECTOR(3072),
 *   text TEXT NOT NULL,
 *   source_file TEXT NOT NULL,
 *   onedrive_file_id TEXT NOT NULL,
 *   folder_path TEXT NOT NULL,
 *   chunk_index INTEGER NOT NULL,
 *   total_chunks INTEGER NOT NULL,
 *   last_modified TIMESTAMPTZ NOT NULL,
 *   created_at TIMESTAMPTZ DEFAULT NOW()
 * );
 *
 * CREATE INDEX idx_chunks_file_id ON document_chunks(onedrive_file_id);
 * CREATE INDEX idx_chunks_file_modified ON document_chunks(onedrive_file_id, last_modified);
 * CREATE INDEX idx_chunks_embedding ON document_chunks USING hnsw (embedding vector_cosine_ops);
 *
 * CREATE TABLE delta_state (
 *   id TEXT PRIMARY KEY DEFAULT 'default',
 *   delta_token TEXT NOT NULL,
 *   updated_at TIMESTAMPTZ DEFAULT NOW()
 * );
 *
 * CREATE OR REPLACE FUNCTION match_documents(
 *   query_embedding VECTOR(3072),
 *   match_count INT DEFAULT 5
 * ) RETURNS TABLE (id TEXT, score FLOAT, text TEXT, metadata JSONB)
 * AS $$
 *   SELECT
 *     dc.id,
 *     1 - (dc.embedding <=> query_embedding) AS score,
 *     dc.text,
 *     jsonb_build_object(
 *       'source_file', dc.source_file,
 *       'onedrive_file_id', dc.onedrive_file_id,
 *       'folder_path', dc.folder_path,
 *       'chunk_index', dc.chunk_index,
 *       'total_chunks', dc.total_chunks,
 *       'last_modified', dc.last_modified
 *     ) AS metadata
 *   FROM document_chunks dc
 *   ORDER BY dc.embedding <=> query_embedding
 *   LIMIT match_count;
 * $$ LANGUAGE sql STABLE;
 *
 * ───────────────────────────────────────────────────────────────────────────
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
  }

  console.log(`Connecting to Supabase at ${url}...`);
  const client = createClient(url, key);

  // Check document_chunks
  const { count: chunksCount, error: chunksError } = await client
    .from("document_chunks")
    .select("*", { count: "exact", head: true });

  if (chunksError) {
    console.error("❌ document_chunks table not found or inaccessible:", chunksError.message);
    console.error("   Run the SQL migration in Supabase SQL Editor first.");
    process.exit(1);
  }
  console.log(`✓ document_chunks: ${chunksCount ?? 0} rows`);

  // Check delta_state
  const { count: stateCount, error: stateError } = await client
    .from("delta_state")
    .select("*", { count: "exact", head: true });

  if (stateError) {
    console.error("❌ delta_state table not found or inaccessible:", stateError.message);
    console.error("   Run the SQL migration in Supabase SQL Editor first.");
    process.exit(1);
  }
  console.log(`✓ delta_state: ${stateCount ?? 0} rows`);

  console.log("\nAll tables verified. Ready to ingest:");
  console.log("  npx tsx src/testLocal.ts");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
