/**
 * Clears all document vectors and the delta state from Supabase,
 * forcing a full re-ingest on the next run.
 * Usage: npx tsx src/reindex.ts
 */
import "dotenv/config";
import { getSupabaseClient } from "./lib/supabaseClient.js";

async function main() {
  console.log("Clearing document_chunks and delta_state from Supabase...");
  const client = getSupabaseClient();

  const { error: chunksError } = await client
    .from("document_chunks")
    .delete()
    .neq("id", "");

  if (chunksError) throw new Error(`Failed to clear chunks: ${chunksError.message}`);
  console.log("document_chunks cleared.");

  const { error: stateError } = await client
    .from("delta_state")
    .delete()
    .eq("id", "default");

  if (stateError) throw new Error(`Failed to clear delta state: ${stateError.message}`);
  console.log("delta_state cleared.");

  console.log("Done. Run: npx tsx src/testLocal.ts");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
