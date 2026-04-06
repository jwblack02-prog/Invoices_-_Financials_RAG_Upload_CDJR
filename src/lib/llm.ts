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
- If the information is not in the context, say "I couldn't find that information in the documents"
- Include which source file(s) the information came from
- Be specific with numbers, dates, and amounts
- When asked about recurring charges or spending over time, list EVERY occurrence found in the context with its date and amount
- If multiple line items exist for the same vendor in a single invoice (e.g., a texting fee and a software fee), list each one separately
- After listing individual charges, provide a total sum
- Format monetary amounts consistently (e.g., $1,157.00)
- If the context appears to be missing months or data, note which months are covered and which may be missing`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  return response.text || "Unable to generate answer.";
}
