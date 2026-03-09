const DEFAULT_IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/';

const metadataCacheByDocUrl = new Map();
const imageResolutionDebugCache = new Set();

const EDITORIAL_IMAGE_FIELDS = ['image', 'coverUrl', 'avatarUrl'];
const METADATA_IMAGE_FIELDS = ['image', 'image_url', 'imageUrl', 'animation_url'];
const ONCHAIN_IMAGE_FIELDS = ['image', 'image_url', 'imageUrl', 'animation_url', 'coverUrl', 'avatarUrl'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function looksLikeBareCidPath(value) {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  return /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[2-7a-z]+)(\/.*)?$/i.test(trimmed);
}

function normalizeGatewayBase(value) {
  const raw = (value || '').toString().trim();
  if (!raw) return DEFAULT_IPFS_GATEWAY;

  if (raw.includes('{cid}')) {
    return raw.replace('{cid}', '').replace(/\/+$/, '/');
  }

  if (/^https?:\/\//i.test(raw)) {
    if (/\/ipfs\/?$/i.test(raw)) return raw.replace(/\/+$/, '/') ;
    return `${raw.replace(/\/+$/, '')}/ipfs/`;
  }

  return DEFAULT_IPFS_GATEWAY;
}

function getIpfsGatewayBase() {
  return normalizeGatewayBase(
    import.meta.env.VITE_IPFS_GATEWAY
      || import.meta.env.VITE_IPFS_GATEWAY_URL
      || import.meta.env.VITE_IPFS_GATEWAY_BASE,
  );
}

export function resolveIpfsUri(value) {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith('ipfs://')) {
    const path = trimmed.slice('ipfs://'.length).replace(/^ipfs\//, '').replace(/^\/+/, '');
    if (!path) return '';
    return `${getIpfsGatewayBase()}${path}`;
  }

  if (looksLikeBareCidPath(trimmed)) {
    return `${getIpfsGatewayBase()}${trimmed.replace(/^\/+/, '')}`;
  }

  return '';
}

export function extractTokenDocumentUrl(tokenInfo) {
  if (!tokenInfo || typeof tokenInfo !== 'object') return '';

  const candidates = [
    tokenInfo.url,
    tokenInfo.documentUrl,
    tokenInfo.documentURI,
    tokenInfo.documentUri,
    tokenInfo.genesisInfo?.url,
    tokenInfo.genesisInfo?.documentUrl,
    tokenInfo.genesisInfo?.documentURI,
    tokenInfo.genesisInfo?.documentUri,
  ];

  const found = candidates.find((entry) => typeof entry === 'string' && entry.trim());
  return found ? found.trim() : '';
}

export async function sha256HexFromString(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (!globalThis.crypto?.subtle) {
    throw new Error('crypto-subtle-unavailable');
  }
  const encoded = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function coerceMetadataObject(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return { ...parsed };
}

function resolveCandidateString(value) {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return resolveIpfsUri(trimmed);
}

function findImageFieldValue(input, prioritizedKeys, seen = new Set()) {
  if (!input) return '';

  if (typeof input === 'string') {
    return resolveCandidateString(input) ? input.trim() : '';
  }

  if (Array.isArray(input)) {
    for (const entry of input) {
      const found = findImageFieldValue(entry, prioritizedKeys, seen);
      if (found) return found;
    }
    return '';
  }

  if (!isPlainObject(input) || seen.has(input)) return '';
  seen.add(input);

  for (const key of prioritizedKeys) {
    if (!(key in input)) continue;
    const found = findImageFieldValue(input[key], prioritizedKeys, seen);
    if (found) return found;
  }

  for (const value of Object.values(input)) {
    const found = findImageFieldValue(value, prioritizedKeys, seen);
    if (found) return found;
  }

  return '';
}

export function extractNftImageCandidate(input, source = 'metadata') {
  const prioritizedKeys = source === 'editorial'
    ? EDITORIAL_IMAGE_FIELDS
    : source === 'onchain'
      ? ONCHAIN_IMAGE_FIELDS
      : METADATA_IMAGE_FIELDS;
  return findImageFieldValue(input, prioritizedKeys);
}

function debugResolvedImage(debugLabel, raw, resolved, source) {
  if (!import.meta.env.DEV || !debugLabel || !raw || !resolved) return;
  const cacheKey = `${debugLabel}|${source}|${raw}|${resolved}`;
  if (imageResolutionDebugCache.has(cacheKey)) return;
  imageResolutionDebugCache.add(cacheKey);
  console.debug(`[nft-image] ${debugLabel}`, { source, raw, resolved });
}

export function pickNftImageUrl({
  local = null,
  ipfs = null,
  onchain = null,
  fallback = '',
  debugLabel = '',
} = {}) {
  const candidates = [
    { source: 'local', raw: extractNftImageCandidate(local, 'editorial') },
    { source: 'ipfs', raw: extractNftImageCandidate(ipfs, 'metadata') },
    { source: 'onchain', raw: extractNftImageCandidate(onchain, 'onchain') },
    { source: 'fallback', raw: typeof fallback === 'string' ? fallback.trim() : '' },
  ];

  for (const candidate of candidates) {
    if (!candidate.raw) continue;
    const resolved = resolveIpfsUri(candidate.raw);
    if (!resolved) continue;
    debugResolvedImage(debugLabel, candidate.raw, resolved, candidate.source);
    return {
      source: candidate.source,
      raw: candidate.raw,
      url: resolved,
      value: resolved,
    };
  }

  return {
    source: '',
    raw: '',
    url: '',
    value: '',
  };
}

async function fetchMetadataFromUrl(documentUrl) {
  const resolvedUrl = resolveIpfsUri(documentUrl);
  if (!resolvedUrl) {
    return { ok: false, attempted: false, metadata: null, documentUrl: documentUrl || '', resolvedUrl: '', error: 'missing-document-url' };
  }

  try {
    const response = await fetch(resolvedUrl, {
      method: 'GET',
      headers: { Accept: 'application/json,text/plain;q=0.9,*/*;q=0.1' },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const rawText = await response.text();
    let parsed = null;

    try {
      parsed = JSON.parse(rawText);
    } catch {
      return {
        ok: false,
        attempted: true,
        metadata: null,
        documentUrl,
        resolvedUrl,
        error: 'invalid-json',
      };
    }

    const metadata = coerceMetadataObject(parsed);
    if (!metadata) {
      return {
        ok: false,
        attempted: true,
        metadata: null,
        documentUrl,
        resolvedUrl,
        error: 'invalid-shape',
      };
    }

    return {
      ok: true,
      attempted: true,
      metadata,
      rawText,
      documentUrl,
      resolvedUrl,
      error: '',
    };
  } catch (err) {
    return {
      ok: false,
      attempted: true,
      metadata: null,
      rawText: '',
      documentUrl,
      resolvedUrl,
      error: err?.message || 'fetch-failed',
    };
  }
}

export async function fetchIpfsMetadataByDocumentUrl(documentUrl) {
  const key = (documentUrl || '').toString().trim();
  if (!key) {
    return { ok: false, attempted: false, metadata: null, rawText: '', documentUrl: '', resolvedUrl: '', error: 'missing-document-url' };
  }

  if (!metadataCacheByDocUrl.has(key)) {
    metadataCacheByDocUrl.set(key, fetchMetadataFromUrl(key));
  }

  return metadataCacheByDocUrl.get(key);
}
