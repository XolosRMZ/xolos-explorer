const LINAJE_META_VERSION = '2026-03-07';

// Metadata editorial local para enriquecer fichas narrativas.
// Fuente de verdad on-chain: el OP_RETURN siempre manda.
// Este archivo solo agrega contexto curatorial (bio, alias, fotos, tags, etc.).
export const LINAJE_EDITORIAL_META = Object.freeze({
  'tika-ramirez': {
    slug: 'tika-ramirez',
    title: 'Tika Ramírez',
    subtitle: 'Entrada editorial local del Archivo del Linaje Vivo',
    narrative: 'Capa editorial local para completar su vínculo genealógico y enlazar a ambos progenitores dentro del archivo.',
    nombreCompleto: 'Tika Ramírez',
    afijo: 'Ramírez',
    variedad: 'Sin pelo',
    color: 'Negro',
    sexo: 'Hembra',
    lugarNacimiento: 'Ciudad de México, México',
    fechaNacimiento: '2025-10-06',
    criador: 'Fernando Ramírez Gutiérrez / Alexandra Ramírez Gutiérrez',
    padre: 'cc43d40fa21304cfde5271a2f897fc0deff14c4854fa2b8f9f58c5a0ab4b171a',
    madre: '70a3b2dbfcf0c4891a5c27a83b1b52cb0a920f10a1720c506ff1849ed2e9bfa4',
    theme: 'codex',
    accent: '#00eaff',
    backgroundNote: 'Registro editorial local usado para completar la genealogía cuando el JSON original no trae ambos padres.',
    tags: ['linaje', 'xoloitzcuintle', 'ramirez', 'tika'],
    nota: 'Entrada curatorial local para resolver padre y madre en la vista de token, árbol y archivo.',
  },
  'tomate-ramirez': {
    slug: 'tomate-ramirez',
    txid: 'cc43d40fa21304cfde5271a2f897fc0deff14c4854fa2b8f9f58c5a0ab4b171a',
    tokenId: 'cc43d40fa21304cfde5271a2f897fc0deff14c4854fa2b8f9f58c5a0ab4b171a',
    title: 'Tomate Ramírez',
    subtitle: 'Entrada editorial local del Archivo del Linaje Vivo',
    narrative: 'Padre incorporado al archivo local para resolver la genealogía de Tika y su ficha individual en /linaje.',
    nombreCompleto: 'Tomate (Ramírez/Ramírez) Mex.',
    afijo: 'Ramírez',
    etapa: 'adulto',
    sexo: 'Macho',
    color: 'Negro',
    variedad: 'Con pelo',
    fechaNacimiento: '2022-04-25',
    lugarNacimiento: 'Ciudad de México, México',
    criador: 'Fernando Ramírez Gutiérrez / Alexandra Ramírez Gutiérrez',
    registroFCM: 'FCMA2526-C',
    microchip: '939000002661506',
    padre: 'Vovid Caliente Mex. FCI',
    madre: 'Frida (Ramírez) Mex.',
    theme: 'obsidian',
    accent: '#00eaff',
    backgroundNote: 'Registro local enlazado al archivo de linaje para conservar continuidad editorial aunque no exista OP_RETURN oficial.',
    tags: ['linaje', 'xoloitzcuintle', 'ramirez', 'tomate', 'padre'],
    nota: 'Entrada curatorial local reconocida como referencia válida del linaje.',
  },
  'frida-ramirez': {
    slug: 'frida-ramirez',
    txid: '70a3b2dbfcf0c4891a5c27a83b1b52cb0a920f10a1720c506ff1849ed2e9bfa4',
    tokenId: '70a3b2dbfcf0c4891a5c27a83b1b52cb0a920f10a1720c506ff1849ed2e9bfa4',
    title: 'Frida Ramírez',
    subtitle: 'Entrada editorial local del Archivo del Linaje Vivo',
    narrative: 'Madre incorporada al archivo local para que la ficha genealógica de Tika resuelva su rama materna.',
    nombreCompleto: 'Frida (Ramírez) Mex.',
    afijo: 'Ramírez',
    etapa: 'adulta',
    sexo: 'Hembra',
    color: 'Negro',
    variedad: 'Sin pelo',
    fechaNacimiento: '2020-04-03',
    lugarNacimiento: 'Ciudad de México, México',
    criador: 'Fernando Ramírez Gutiérrez / Alexandra Ramírez Gutiérrez',
    registroFCM: 'FCMC4734',
    microchip: '939000002599643',
    theme: 'jade',
    accent: '#00eaff',
    backgroundNote: 'Registro local enlazado al archivo de linaje para resolver la ascendencia materna sin invalidar la jerarquía on-chain.',
    tags: ['linaje', 'xoloitzcuintle', 'ramirez', 'frida', 'madre'],
    nota: 'Entrada curatorial local reconocida como referencia válida del linaje.',
  },
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
    const candidates = [meta.txid, meta.tokenId, meta.nftTokenId]
      .filter((value) => typeof value === 'string')
      .map((value) => value.toLowerCase());
    if (candidates.includes(target)) return meta;
  }

  return null;
}

export function resolveLinajeMeta({ slug = '', txid = '' } = {}) {
  const bySlug = findLinajeMetaBySlug(slug);
  if (bySlug) return bySlug;
  return findLinajeMetaByTxid(txid);
}

export { LINAJE_META_VERSION };
