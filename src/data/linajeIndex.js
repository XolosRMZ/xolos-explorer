const LINAGE_INDEX_VERSION = '2026-03-27';

// Índice local persistente: slug -> txid.
// Mantén este archivo en control de versiones para resolución estable.
export const LINAJE_SLUG_INDEX = Object.freeze({
  'tomate-ramirez': 'cc43d40fa21304cfde5271a2f897fc0deff14c4854fa2b8f9f58c5a0ab4b171a',
  'frida-ramirez': '70a3b2dbfcf0c4891a5c27a83b1b52cb0a920f10a1720c506ff1849ed2e9bfa4',
  'ikal-caliente': '415b0d971d78ccf465c8a0b99b74edee950e0bdbacc6a941cb8f44b1874867f4',
  'kiwi-ramirez': '5bcf1823927af2645c310037666a3852a5726b9526c03550c820282b7c48ed2a',
  'ixchel-ramirez': 'bde767e246706ddaa4c208aa913285ac7e0e4517b5eaedaf40b0b15a42207e95',
  'rima-langarica': 'a4c358ca51058e3b893a3579c0d558bec17a5854d2fd7200aa0d42b8c0ea76ca',
  'jicamo-lopez': '44b35bf6dfb472b982bf6964f9eeb6783b5eea5ab71e7adb84246b61ff4371f5',
  'ticuiz-langarica': 'a4c6f91bc781ae03d82b71345715b9590a5cbea5ccccd4a9d505fef1da5b7bc3',
  'bolero-ramirez': 'Draft_Token_BOLERO_RAMIREZ_FCMZZ1560-A',
  'chontal-ramirez': 'fb0f49f9b6c5b701c637afbe6c10088fe11b4689bdf7a3800e62ba1a192499ab',
  'uxmal-avila': '1dc6943cc081e410646c1466653a1c6937815ce6a05253f0e541620e47bb3d7f',
  'humo-ramirez': '13a2fd97493e2c15ec1077465da11dd602e86fbf4e200b9c4bb72dab78c199ea'
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
