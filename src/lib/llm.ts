import { GoogleGenAI } from "@google/genai";

let genai: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI {
  if (!genai) {
    genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  }
  return genai;
}

export async function generateAnswer(
  question: string,
  chunks: Array<{ text: string; metadata: Record<string, any> }>
): Promise<string> {
  const ai = getGenAI();

  const context = chunks
    .map(
      (c, i) =>
        `[${i + 1}] (${c.metadata.source_file}, chunk ${c.metadata.chunk_index}/${c.metadata.total_chunks}):\n${c.text}`
    )
    .join("\n\n---\n\n");

  const prompt = `You are a financial document assistant for Black Automotive Group's CDJR dealership. Answer the following question based ONLY on the provided document context.

CONTEXT FROM DOCUMENTS:
${context}

QUESTION: ${question}

Instructions:
- Answer based only on the provided context
- Do NOT include source filenames or PDF names in your answer — sources are displayed separately below your response
- If the information is not in the context, say "I couldn't find that information in the documents"
- Be specific with numbers, dates, and amounts — format as $1,157.00
- When asked about recurring charges or spending over time:
  * CRITICAL: Read EVERY context chunk from start to finish — charges for a vendor often appear inside multi-vendor invoice PDFs whose filenames do not mention the vendor at all
  * Organize your answer as a bulleted list sorted chronologically by month
  * For each month, show: the charge amount, a brief description, and the service period it covers
  * If multiple line items exist for the same vendor in a single invoice (e.g., a texting fee and a subscription fee), list each one as a separate bullet under that month
  * After all monthly bullets, provide a grand total
  * Note: FCA invoices are typically issued the month AFTER the service period (e.g., an October invoice covers September service)
  * Explicitly state which months are covered and which appear to be missing — do not assume missing means zero
- For non-recurring questions, use bullet points where appropriate for clarity`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  return response.text || "Unable to generate answer.";
}
