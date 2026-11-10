/** Matching the spreadsheet's free-text descriptions with each other and with the catalog. */

/** "Energia (Luce)" → "energia luce", "Ass. Vita Prestito Viol." → "ass vita prestito viol". */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const tokens = (s: string) => normalize(s).split(' ').filter((t) => t.length > 1 || /\d/.test(t));

/**
 * Similarity in [0, 1]: 1 for the same normalized text, high when one is the
 * other with something added ("Spesa (500€)" ~ "Spesa"), otherwise token overlap
 * where a token matches its abbreviation ("viol" ~ "viola").
 */
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const same = (x: string, y: string) => x === y || (x.length >= 3 && y.startsWith(x)) || (y.length >= 3 && x.startsWith(y));
  const hits = ta.filter((x) => tb.some((y) => same(x, y))).length;
  const hitsB = tb.filter((y) => ta.some((x) => same(x, y))).length;
  // All the words of the shorter one are in the longer one.
  if (hits === ta.length || hitsB === tb.length) return 0.9 - 0.02 * Math.abs(ta.length - tb.length);
  return (hits + hitsB) / (ta.length + tb.length);
}

export interface Match<T> {
  item: T;
  score: number;
}

/** Best candidate above `threshold`, or null. Ties go to the first candidate. */
export function bestMatch<T>(name: string, candidates: T[], key: (t: T) => string, threshold = 0.75): Match<T> | null {
  let best: Match<T> | null = null;
  for (const c of candidates) {
    const score = similarity(name, key(c));
    if (score >= threshold && (!best || score > best.score)) best = { item: c, score };
  }
  return best;
}
