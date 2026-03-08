const LINAJE_META_VERSION = '2026-03-07';

// Metadata editorial local para enriquecer fichas narrativas.
// Fuente de verdad on-chain: el OP_RETURN siempre manda.
// Este archivo solo agrega contexto curatorial (bio, alias, fotos, tags, etc.).
export const LINAJE_EDITORIAL_META = Object.freeze({
  // Ejemplo:
  // 'tika-ramirez': {
  //   txid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  //   title: 'Tika Ramírez',
  //   subtitle: 'Ficha oficial de linaje',
  //   narrative: 'Primera inscripción narrativa del Archivo del Linaje Vivo.',
  //   nombreCompleto: 'Tika Ramírez',
  //   afijo: 'Ramírez',
  //   variedad: 'Sin pelo',
  //   color: 'Negro',
  //   sexo: 'Hembra',
  //   lugarNacimiento: 'Ciudad de México, México',
  //   fechaNacimiento: '2025-10-06',
  //   criador: 'Fernando Ramírez / Alexandra Ramírez',
  //   padre: '',
  //   madre: '',
  //   camada: '',
  //   microchip: '',
  //   registroFCM: '',
  //   entregaEstado: '',
  //   nftLinaje: '',
  //   image: '/linaje/tika.webp',
  //   imageAlt: 'Retrato curatorial de Tika Ramírez',
  //   imagePlaceholder: 'TR',
  //   avatarUrl: '/linaje/tika.webp',
  //   coverUrl: '/linaje/tika-cover.webp',
  //   theme: 'codex', // opcional: obsidian | codex | jade | ritual | neon
  //   accent: '#00eaff', // opcional: color CSS para acento visual en ficha individual
  //   backgroundNote: 'Nota ceremonial opcional para la entrada curada.',
  //   tags: ['linaje', 'xoloitzcuintle', 'ramirez'],
  //   nota: 'Primera inscripción narrativa del Archivo del Linaje Vivo.',
  //   links: {
  //     sitio: '',
  //     nft: '',
  //     pedigree: '',
  //   },
  // },
});

function normalizeKey(value) {
  if (!value || typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function isHex64(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

export function findLinajeMetaBySlug(slug) {
  const key = normalizeKey(slug);
  if (!key) return null;
  return LINAJE_EDITORIAL_META[key] || null;
}

export function findLinajeMetaByTxid(txid) {
  if (!isHex64(txid)) return null;
  const target = txid.toLowerCase();

  for (const meta of Object.values(LINAJE_EDITORIAL_META)) {
    if (!meta || typeof meta !== 'object') continue;
    if (typeof meta.txid !== 'string') continue;
    if (meta.txid.toLowerCase() === target) return meta;
  }

  return null;
}

export function resolveLinajeMeta({ slug = '', txid = '' } = {}) {
  const bySlug = findLinajeMetaBySlug(slug);
  if (bySlug) return bySlug;
  return findLinajeMetaByTxid(txid);
}

export { LINAJE_META_VERSION };
