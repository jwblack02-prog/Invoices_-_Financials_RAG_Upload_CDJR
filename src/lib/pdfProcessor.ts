import { extractText } from "unpdf";
import type { ChunkRecord } from "./types.js";

const PAGE_CHUNK_LIMIT = parseInt(process.env.PAGE_CHUNK_LIMIT || "1500", 10);
const LARGE_PAGE_OVERLAP = parseInt(process.env.LARGE_PAGE_OVERLAP || "200", 10);
const HEADER_LENGTH = parseInt(process.env.HEADER_LENGTH || "200", 10);

function slugify(text: string): string {
  return text
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

/**
 * Page-aware chunking: each page becomes one chunk if small enough,
 * otherwise split with overlap. Every chunk gets a page marker and
 * the invoice header (first page's opening text) for context.
 */
function chunkPages(
  pages: string[],
  fileName: string,
  headerLength: number = HEADER_LENGTH,
  pageLimit: number = PAGE_CHUNK_LIMIT,
  overlap: number = LARGE_PAGE_OVERLAP
): string[] {
  const chunks: string[] = [];
  const totalPages = pages.length;

  // Extract invoice header from first page (vendor, date, invoice # typically here)
  const invoiceHeader = pages[0]?.slice(0, headerLength).trim() || "";

  for (let i = 0; i < totalPages; i++) {
    const pageText = pages[i].trim();
    if (!pageText) continue;

    const pageMarker = `[Page ${i + 1} of ${totalPages} | ${fileName}]`;
    const prefix = i > 0 && invoiceHeader
      ? `${pageMarker}\n[Invoice header: ${invoiceHeader}]\n\n`
      : `${pageMarker}\n\n`;

    const fullText = prefix + pageText;

    if (fullText.length <= pageLimit) {
      chunks.push(fullText);
    } else {
      // Split large pages, keeping prefix on each sub-chunk
      let start = 0;
      const contentOnly = pageText;
      const step = pageLimit - prefix.length - overlap;

      while (start < contentOnly.length) {
        const end = Math.min(start + pageLimit - prefix.length, contentOnly.length);
        const slice = contentOnly.slice(start, end).trim();
        if (slice.length > 0) {
          chunks.push(prefix + slice);
        }
        start += Math.max(step, 1);
      }
    }
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
  lastModified: string,
  webUrl: string = ""
): Promise<ChunkRecord[]> {
  const parsed = await extractText(new Uint8Array(pdfBuffer));

  // unpdf returns text as string[] (one per page) — keep as pages for page-aware chunking
  let pages: string[] = Array.isArray(parsed.text)
    ? parsed.text
    : [String(parsed.text || "")];

  const hasText = pages.some((p) => p.trim().length > 0);

  // If unpdf extracted nothing, try Mistral OCR (handles scanned/image PDFs)
  if (!hasText) {
    console.log(`Warning: No text from unpdf for ${fileName} — trying Mistral OCR`);
    const ocrText = await mistralOCR(pdfBuffer, fileName);
    if (ocrText && ocrText.trim().length > 0) {
      // Mistral OCR returns pages separated by \n\n
      pages = ocrText.split("\n\n").filter((p) => p.trim().length > 0);
    }
  }

  if (!pages.some((p) => p.trim().length > 0)) {
    console.log(`Warning: No text extracted from ${fileName} — skipping`);
    return [];
  }

  const chunks = chunkPages(pages, fileName);
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
      web_url: webUrl,
    },
  }));
}
