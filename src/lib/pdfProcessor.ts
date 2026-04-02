import { extractText } from "unpdf";
import type { ChunkRecord } from "./types.js";

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || "900", 10);
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP || "175", 10);

function slugify(text: string): string {
  return text
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    start += chunkSize - overlap;
  }

  return chunks;
}

export async function extractAndChunk(
  pdfBuffer: Buffer,
  fileId: string,
  fileName: string,
  folderPath: string,
  lastModified: string
): Promise<ChunkRecord[]> {
  const parsed = await extractText(new Uint8Array(pdfBuffer));
  // unpdf returns text as string[] (one per page) — join into a single string
  const fullText = Array.isArray(parsed.text)
    ? parsed.text.join("\n")
    : String(parsed.text || "");

  if (!fullText || fullText.trim().length === 0) {
    console.log(`Warning: No text extracted from ${fileName} — may be a scanned/image PDF`);
    return [];
  }

  const chunks = chunkText(fullText, CHUNK_SIZE, CHUNK_OVERLAP);
  const sluggedId = slugify(fileId);

  return chunks.map((text, i) => ({
    id: `${sluggedId}_c${i}`,
    text,
    metadata: {
      source_file: fileName,
      onedrive_file_id: fileId,
      folder_path: folderPath,
      chunk_index: i,
      total_chunks: chunks.length,
      last_modified: lastModified,
    },
  }));
}
