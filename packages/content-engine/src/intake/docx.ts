// DOCX text extraction for DLO uploads. DOCX carries its text in XML, so plain
// local extraction (mammoth) is enough — no OCR service needed, unlike PDFs.

import mammoth from 'mammoth';

export async function extractDocxText(
  name: string,
  data: Buffer,
): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: data });
  const text = result.value.trim();
  if (!text) {
    throw new Error(`DOCX file ${name} contained no extractable text.`);
  }
  return text;
}
