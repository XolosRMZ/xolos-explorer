const DEFAULT_IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/';

const metadataCacheByDocUrl = new Map();

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

  if (trimmed.startsWith('ipfs://')) {
    const path = trimmed.slice('ipfs://'.length).replace(/^ipfs\//, '').replace(/^\/+/, '');
    if (!path) return '';
    return `${getIpfsGatewayBase()}${path}`;
  }

  return trimmed;
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

  const normalized = { ...parsed };
  if (typeof normalized.image === 'string') {
    normalized.image = resolveIpfsUri(normalized.image);
  }
  return normalized;
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
