export function normalize(value) { return value.normalize('NFKC').toLocaleLowerCase('ja').trim(); }
export function filterEntries(entries, { query = '', category = 'all', type = 'all' } = {}) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (category !== 'all' && !(entry.areas || [entry.category]).includes(category)) return false;
    if (type !== 'all' && entry.type !== type) return false;
    const text = normalize([entry.title, entry.englishName || '', entry.summary, ...entry.tags, ...(entry.sections || []).map((s) => `${s.heading} ${s.body}`)].join(' '));
    return words.every((word) => text.includes(word));
  });
}
