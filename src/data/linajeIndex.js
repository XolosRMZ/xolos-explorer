const LINAGE_INDEX_VERSION = '2026-03-07';

// Índice local persistente: slug -> txid.
// Mantén este archivo en control de versiones para resolución estable.
export const LINAJE_SLUG_INDEX = Object.freeze({
  // 'tika-ramirez': '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
});

function normalizeSlugKey(slug) {
  if (!slug || typeof slug !== 'string') return '';
  return slug.trim().toLowerCase();
}

export function findLinajeTxidBySlug(slug) {
  const key = normalizeSlugKey(slug);
  if (!key) return '';
  return LINAJE_SLUG_INDEX[key] || '';
}

export { LINAGE_INDEX_VERSION };
