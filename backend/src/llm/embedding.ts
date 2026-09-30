const DIM = 384;

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function features(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  const words = lower.match(/[a-z0-9]+/g) ?? [];
  for (const w of words) out.push('w:' + w);
  const cjk = lower.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const seq of cjk) {
    if (seq.length === 1) {
      out.push('c:' + seq);
    } else {
      for (const ch of seq) out.push('c:' + ch);
      for (let i = 0; i < seq.length - 1; i++) out.push('b:' + seq.slice(i, i + 2));
    }
  }
  return out;
}

export function localEmbed(texts: string[]): number[][] {
  return texts.map((text) => {
    const vec = new Array(DIM).fill(0);
    for (const f of features(text)) {
      const h = fnv1a(f);
      const idx = h % DIM;
      const sign = (h & 1) === 0 ? 1 : -1;
      vec[idx] += sign;
    }
    let norm = 0;
    for (const x of vec) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < DIM; i++) vec[i] /= norm;
    return vec;
  });
}