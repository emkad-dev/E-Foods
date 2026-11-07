// Builds the human-readable line a Nigerian user recognises. Providers return
// the same place name in several fields (name == street, city == state), so
// repeats are dropped case-insensitively.
export const joinLabel = (parts: Array<string | null | undefined>): string => {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of parts) {
    const text = typeof part === 'string' ? part.trim().replace(/\s+/g, ' ') : '';
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(text);
  }
  return kept.join(', ');
};

export const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;
