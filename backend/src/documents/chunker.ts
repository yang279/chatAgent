const SENTENCE_END = '。！？.!?';

export function splitText(text: string, maxLen = 800, overlap = 100): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxLen) return [cleaned];

  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = Math.min(start + maxLen, cleaned.length);
    if (end < cleaned.length) {
      let lastBreak = -1;
      for (let i = end - 1; i > start; i--) {
        if (SENTENCE_END.includes(cleaned[i])) {
          lastBreak = i + 1;
          break;
        }
      }
      if (lastBreak - start > maxLen * 0.5) end = lastBreak;
    }
    chunks.push(cleaned.slice(start, end).trim());
    if (end >= cleaned.length) break;
    start = end - overlap;
  }
  return chunks.filter((c) => c.length > 0);
}