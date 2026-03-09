import React from 'react';
import { Hash, Shield } from 'lucide-react';
import { LINAJE_SLUG_INDEX } from '../data/linajeIndex';
import { LINAJE_EDITORIAL_META, resolveLinajeMeta } from '../data/linajeMeta';
import { pickNftImageUrl } from '../utils/ipfsMetadata';

function normalizeKey(value) {
  if (!value || typeof value !== 'string') return '';
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function findSlugByTokenId(tokenId) {
  const target = normalizeKey(tokenId);
  if (!target) return '';

  return Object.entries(LINAJE_SLUG_INDEX).find(([, txid]) => normalizeKey(txid) === target)?.[0] || '';
}

function pickAttribute(meta, traitNames = []) {
  if (!Array.isArray(meta?.attributes) || traitNames.length === 0) return '';

  const normalizedTraits = traitNames.map((name) => normalizeKey(name));
  const match = meta.attributes.find((attr) => {
    const traitType = normalizeKey(attr?.trait_type);
    return traitType && normalizedTraits.includes(traitType);
  });

  return match?.value ? String(match.value) : '';
}

export function XoloCard({ tokenId }) {
  const [imageFailed, setImageFailed] = React.useState(false);

  const resolvedMeta = React.useMemo(() => {
    const slugFromIndex = findSlugByTokenId(tokenId);
    const byToken = resolveLinajeMeta({ txid: tokenId, slug: tokenId });
    const bySlug = slugFromIndex ? resolveLinajeMeta({ slug: slugFromIndex }) : null;
    const byRawSlug = LINAJE_EDITORIAL_META[normalizeKey(tokenId)] || null;

    return byToken || bySlug || byRawSlug || null;
  }, [tokenId]);

  if (!resolvedMeta) return null;

  const rank = pickAttribute(resolvedMeta, ['Rango']) || resolvedMeta.rango || 'Soldado';
  const generation = pickAttribute(resolvedMeta, ['Generacion']) || resolvedMeta.generacion || '1';
  const name = resolvedMeta.title || resolvedMeta.nombreCompleto || resolvedMeta.name || `Xolo ${tokenId}`;
  const description = resolvedMeta.narrative || resolvedMeta.nota || resolvedMeta.description || 'Registro editorial del linaje.';
  const resolvedImage = React.useMemo(
    () => pickNftImageUrl({ local: resolvedMeta, debugLabel: `xolo-card:${tokenId}` }),
    [resolvedMeta, tokenId],
  );
  const imageUrl = resolvedImage.url;

  React.useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  return (
    <div
      style={{
        marginTop: '24px',
        border: '2px solid #00eaff',
        borderRadius: '12px',
        overflow: 'hidden',
        background: 'linear-gradient(150deg, #05080a 0%, #0a1318 52%, #071219 100%)',
        boxShadow: '0 0 20px rgba(0, 234, 255, 0.16)',
      }}
    >
      <div
        style={{
          background: '#00eaff',
          color: '#001317',
          fontWeight: 700,
          fontSize: '0.72rem',
          letterSpacing: '0.16em',
          textAlign: 'center',
          padding: '5px 12px',
        }}
      >
        EXPEDIENTE TACTICO | LINAJE VERIFICADO
      </div>

      <div
        className="xolo-card-responsive"
        style={{
          display: 'grid',
          gap: '16px',
          padding: '16px',
          gridTemplateColumns: 'minmax(180px, 1fr) minmax(200px, 1.45fr)',
        }}
      >
        <div
          style={{
            border: '1px solid #1a4f58',
            borderRadius: '8px',
            minHeight: '180px',
            overflow: 'hidden',
            background: '#091015',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {imageUrl && !imageFailed ? (
            <img
              src={imageUrl}
              alt={name}
              loading="lazy"
              onError={() => setImageFailed(true)}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                filter: 'grayscale(20%) contrast(115%)',
              }}
            />
          ) : (
            <div style={{ color: '#7ec7cf', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '0.08em' }}>
              XOLO IDENTIFICADO
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gap: '10px' }}>
          <h2
            style={{
              margin: 0,
              color: '#00eaff',
              fontSize: '1.24rem',
              textTransform: 'uppercase',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            {name}
          </h2>
          <p style={{ margin: 0, color: '#c8d6d8', lineHeight: 1.45 }}>{description}</p>

          <div style={{ display: 'grid', gap: '8px', marginTop: '4px', fontSize: '0.88rem', color: '#ecf7f8' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Shield size={16} color="#00eaff" />
              <span>Rango: {rank}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Hash size={16} color="#00eaff" />
              <span>Generacion: {generation}</span>
            </div>
          </div>
        </div>
      </div>

      <style>
        {`@media (max-width: 640px) { .xolo-card-responsive { grid-template-columns: 1fr !important; } }`}
      </style>
    </div>
  );
}
