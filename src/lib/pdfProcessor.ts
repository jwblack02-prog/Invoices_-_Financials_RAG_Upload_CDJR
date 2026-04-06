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

async function mistralOCR(pdfBuffer: Buffer, fileName: string): Promise<string> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    console.log(`  No MISTRAL_API_KEY set — skipping OCR for ${fileName}`);
    return "";
  }

  console.log(`  Attempting Mistral OCR for ${fileName}...`);
  try {
    const base64 = pdfBuffer.toString("base64");

    const response = await fetch("https://api.mistral.ai/v1/ocr", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "mistral-ocr-latest",
        document: {
          type: "document_url",
          document_url: `data:application/pdf;base64,${base64}`,
        },
      }),
    });

    if (!response.ok) {
      console.warn(`  Mistral OCR error: ${response.status} ${await response.text()}`);
      return "";
    }

    const result = await response.json() as any;
    // Mistral OCR returns pages array with markdown text per page
    const pages: string[] = (result.pages || []).map((p: any) => p.markdown || "");
    return pages.join("\n\n");
  } catch (err) {
    console.warn(`  Mistral OCR exception for ${fileName}:`, err);
    return "";
  }
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
  let fullText = Array.isArray(parsed.text)
    ? parsed.text.join("\n")
    : String(parsed.text || "");

  // If unpdf extracted nothing, try Mistral OCR (handles scanned/image PDFs)
  if (!fullText || fullText.trim().length === 0) {
    console.log(`Warning: No text from unpdf for ${fileName} — trying Mistral OCR`);
    fullText = await mistralOCR(pdfBuffer, fileName);
  }

  if (!fullText || fullText.trim().length === 0) {
    console.log(`Warning: No text extracted from ${fileName} — skipping`);
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
