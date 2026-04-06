import type { SupabaseClient } from "@supabase/supabase-js";

export async function readDeltaToken(client: SupabaseClient): Promise<string | null> {
  try {
    const { data, error } = await client
      .from("delta_state")
      .select("delta_token")
      .eq("id", "default")
      .single();

    if (error || !data) return null;
    return data.delta_token as string;
  } catch {
    return null;
  }
}

export async function saveDeltaToken(
  client: SupabaseClient,
  token: string
): Promise<void> {
  const { error } = await client.from("delta_state").upsert({
    id: "default",
    delta_token: token,
    updated_at: new Date().toISOString(),
  });

  if (error) throw new Error(`Failed to save delta token: ${error.message}`);
}
