import React, { useMemo, useState } from 'react';
import { BrowserRouter, Link, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { ChronikClient } from 'chronik-client';
import * as ecashaddr from 'ecashaddrjs';
import { findLinajeTxidBySlug } from './data/linajeIndex';
import { resolveLinajeMeta } from './data/linajeMeta';

const CHRONIK_URL = 'https://chronik.xolosarmy.xyz';
const chronik = new ChronikClient(CHRONIK_URL);

function detectQueryType(value) {
  const q = value.trim();
  if (!q) return 'empty';
  if (/^[0-9]+$/.test(q)) return 'block-height';
  if (/^(ecash:|bitcoincash:)/i.test(q)) return 'address';
  if (/^[0-9a-fA-F]{64}$/.test(q)) return 'hash';
  return 'unknown';
}

function safeStringify(obj) {
  return JSON.stringify(
    obj,
    (_, value) => (typeof value === 'bigint' ? value.toString() : value),
    2,
  );
}

function shortHex(value = '', start = 14, end = 10) {
  if (!value) return '—';
  if (value.length <= start + end) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

function unixToText(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('es-MX');
}

function formatNumber(value) {
  if (value === undefined || value === null || value === '') return '—';
  return new Intl.NumberFormat('es-MX').format(Number(value));
}

function satsToXec(sats) {
  if (sats === undefined || sats === null) return '—';
  const n = Number(sats) / 100;
  return `${new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)} XEC`;
}

function outputScriptToAddress(outputScript) {
  try {
    if (!outputScript || typeof outputScript !== 'string') return null;

    if (outputScript.startsWith('76a914') && outputScript.endsWith('88ac') && outputScript.length === 50) {
      const hash = outputScript.slice(6, -4);
      return ecashaddr.encodeCashAddress('ecash', 'p2pkh', hash);
    }

    if (outputScript.startsWith('a914') && outputScript.endsWith('87') && outputScript.length === 46) {
      const hash = outputScript.slice(4, -2);
      return ecashaddr.encodeCashAddress('ecash', 'p2sh', hash);
    }

    return null;
  } catch {
    return null;
  }
}

function isOpReturn(outputScript) {
  return typeof outputScript === 'string' && outputScript.startsWith('6a');
}

function decodeHexToAscii(hex) {
  try {
    if (!hex || typeof hex !== 'string') return '';
    let clean = hex.replace(/^6a/, '');
    if (clean.length % 2 !== 0) return clean;
    const bytes = clean.match(/.{1,2}/g) || [];
    let text = '';
    for (const b of bytes) {
      const code = parseInt(b, 16);
      if (Number.isNaN(code)) continue;
      text += code >= 32 && code <= 126 ? String.fromCharCode(code) : '.';
    }
    return text;
  } catch {
    return '';
  }
}

function extractOpReturnText(outputScript) {
  if (!isOpReturn(outputScript)) return null;
  const ascii = decodeHexToAscii(outputScript);
  return ascii || outputScript;
}

// Formato oficial de registro de linaje:
// XOLO|RAMIREZ|NOMBRE=TIKA|NAC=2025-10-06|LUGAR=CDMX|SEXO=H|COLOR=NEGRO|VAR=SINPELO
function isXolosLinajeRecord(text) {
  if (!text || typeof text !== 'string') return false;
  return text.startsWith('XOLO|RAMIREZ|');
}

function parseLinajeRecord(text) {
  if (!isXolosLinajeRecord(text)) return null;

  const parts = text.split('|');
  const data = {};

  for (const part of parts.slice(2)) {
    const [key, ...rest] = part.split('=');
    if (!key || rest.length === 0) continue;
    data[key] = rest.join('=');
  }

  return data;
}

function isHex64(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value);
}

function slugify(value) {
  if (!value || typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildLinajeSlug(parsed) {
  const nameSlug = slugify(parsed?.NOMBRE || '');
  if (!nameSlug) return '';
  if (nameSlug.endsWith('-ramirez') || nameSlug === 'ramirez') return nameSlug;
  return `${nameSlug}-ramirez`;
}

function extractLinajeRecordsFromTx(tx) {
  return (tx?.outputs || [])
    .filter((o) => isOpReturn(o.outputScript))
    .map((o) => {
      const text = extractOpReturnText(o.outputScript);
      const parsed = parseLinajeRecord(text);
      return {
        text,
        parsed,
        slug: buildLinajeSlug(parsed),
      };
    })
    .filter((op) => isXolosLinajeRecord(op.text));
}

function enrichLinajeRecord(record, txid) {
  const slug = record?.slug || buildLinajeSlug(record?.parsed);
  const indexedTxid = slug ? findLinajeTxidBySlug(slug) : '';
  const editorialMeta = resolveLinajeMeta({ slug, txid });
  return {
    ...record,
    slug,
    indexedTxid,
    editorialMeta,
  };
}

async function fetchRecentLinajeMatches(maxBlocks = 20, txPageSize = 25) {
  const tip = await chronik.blockchainInfo();
  const tipHeight = tip.tipHeight;

  const heights = [];
  for (let h = tipHeight; h > Math.max(0, tipHeight - (maxBlocks - 1)); h--) {
    heights.push(h);
  }

  const txPages = await Promise.all(
    heights.map((h) => chronik.blockTxs(h.toString(), 0, txPageSize))
  );

  const allTxs = txPages.flatMap((page) => page.txs || []);

  return allTxs
    .map((tx) => ({
      tx,
      opReturns: extractLinajeRecordsFromTx(tx),
    }))
    .filter((item) => item.opReturns.length > 0);
}

function Box({ children, style = {} }) {
  return (
    <div
      style={{
        border: '1px solid #00eaff',
        padding: '14px',
        background: '#0b0b0b',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Shell({ children }) {
  return (
    <div
      style={{
        background: '#050505',
        color: '#00eaff',
        minHeight: '100vh',
        padding: '40px',
        fontFamily: 'monospace',
      }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ marginBottom: '20px' }}>
          <Link to="/" style={{ color: '#00eaff', textDecoration: 'none' }}>
            <h1 style={{ fontSize: '3rem', marginBottom: '10px' }}>XOLOS EXPLORER</h1>
          </Link>
          <p style={{ color: '#8ff7ff', marginBottom: '20px' }}>
            Explorador mínimo avanzado conectado a tu Chronik soberano
          </p>
          <Box style={{ marginBottom: '20px' }}>
            <div><strong>Endpoint:</strong> {CHRONIK_URL}</div>
          </Box>

          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
            <Link to="/explorer" style={{ color: '#00eaff' }}>Explorer</Link>
            <Link to="/linaje" style={{ color: '#00eaff' }}>Linaje</Link>
            <Link to="/block/9000" style={{ color: '#00eaff' }}>Bloque ejemplo</Link>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function SearchBar() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const queryType = useMemo(() => detectQueryType(query), [query]);

  function handleGo() {
    const q = query.trim();
    if (!q) return;

    if (queryType === 'block-height') {
      navigate(`/block/${q}`);
      return;
    }

    if (queryType === 'address') {
      navigate(`/address/${encodeURIComponent(q)}`);
      return;
    }

    if (queryType === 'hash') {
      navigate(`/search/${q}`);
      return;
    }

    alert('Entrada no reconocida. Usa una altura, dirección ecash: o hash de 64 caracteres.');
  }

  return (
    <>
      <input
        placeholder="Buscar bloque, txid, token id o dirección ecash..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleGo()}
        style={{
          width: '100%',
          padding: '14px',
          background: '#111',
          border: '1px solid #00eaff',
          color: '#00eaff',
          fontSize: '1rem',
        }}
      />

      <div style={{ marginTop: '10px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button
          onClick={handleGo}
          style={{
            padding: '12px 18px',
            background: '#00eaff',
            border: 'none',
            color: '#000',
            cursor: 'pointer',
            fontWeight: 'bold',
          }}
        >
          Buscar
        </button>

        <button
          onClick={() => navigate('/block/9000')}
          style={{
            padding: '12px 18px',
            background: '#111',
            border: '1px solid #00eaff',
            color: '#00eaff',
            cursor: 'pointer',
          }}
        >
          Ejemplo bloque
        </button>
      </div>

      <p style={{ marginTop: '12px', color: '#8ff7ff' }}>
        Tipo detectado: <strong>{queryType}</strong>
      </p>
    </>
  );
}

function LoadingBox({ text = 'Olfateando la blockchain...' }) {
  return <Box style={{ marginTop: '20px' }}>{text}</Box>;
}

function ErrorBox({ error }) {
  return (
    <div
      style={{
        marginTop: '20px',
        border: '1px solid #ff5c5c',
        background: '#1a0b0b',
        color: '#ff9e9e',
        padding: '14px',
      }}
    >
      {error}
    </div>
  );
}

function StatGrid({ items }) {
  return (
    <div
      style={{
        marginTop: '24px',
        display: 'grid',
        gap: '12px',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      }}
    >
      {items.map((item, i) => (
        <Box key={i}>
          <div style={{ color: '#8ff7ff', marginBottom: '8px' }}>{item.label}</div>
          <strong style={{ wordBreak: 'break-word' }}>{item.value}</strong>
        </Box>
      ))}
    </div>
  );
}

function SectionTitle({ children }) {
  return <h2 style={{ marginTop: '28px', marginBottom: '12px' }}>{children}</h2>;
}

function LinajeCard({ tx, opReturnText, parsed, slug = '', editorialMeta = null, indexedTxid = '', showDetailLink = true }) {
  const sexoMap = {
    H: 'Hembra',
    M: 'Macho',
  };
  const [imageFailed, setImageFailed] = React.useState(false);

  const resolvedSlug = slug || buildLinajeSlug(parsed);
  const localMeta = editorialMeta || resolveLinajeMeta({ slug: resolvedSlug, txid: tx?.txid });
  const displayName = localMeta?.title || localMeta?.nombreCompleto || parsed?.NOMBRE || 'Sin nombre';
  const displaySexo = localMeta?.sexo || (parsed?.SEXO ? sexoMap[parsed.SEXO] || parsed.SEXO : '—');
  const mediaUrl = localMeta?.image || localMeta?.coverUrl || localMeta?.avatarUrl || '';
  const placeholderText = localMeta?.imagePlaceholder || (displayName ? displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() : 'XOLO');
  const imageAlt = localMeta?.imageAlt || `Retrato de ${displayName}`;
  const showImage = Boolean(mediaUrl) && !imageFailed;
  const detailPath = resolvedSlug ? `/linaje/${resolvedSlug}` : `/linaje/${tx.txid}`;
  const localIndexTxid = indexedTxid || (resolvedSlug ? findLinajeTxidBySlug(resolvedSlug) : '');
  const hasIndexedSlug = isHex64(localIndexTxid);
  const ficha = {
    nombreCompleto: localMeta?.nombreCompleto || parsed?.NOMBRE || '—',
    afijo: localMeta?.afijo || '—',
    variedad: localMeta?.variedad || parsed?.VAR || '—',
    color: localMeta?.color || parsed?.COLOR || '—',
    sexo: displaySexo || '—',
    lugarNacimiento: localMeta?.lugarNacimiento || parsed?.LUGAR || '—',
    fechaNacimiento: localMeta?.fechaNacimiento || parsed?.NAC || '—',
    criador: localMeta?.criador || '—',
    padre: localMeta?.padre || '—',
    madre: localMeta?.madre || '—',
    camada: localMeta?.camada || '—',
    microchip: localMeta?.microchip || '—',
    registroFCM: localMeta?.registroFCM || '—',
    entregaEstado: localMeta?.entregaEstado || '—',
    nftLinaje: localMeta?.nftLinaje || '—',
  };
  const editorialText = localMeta?.narrative || localMeta?.nota || '';
  const linkEntries = Array.isArray(localMeta?.links)
    ? localMeta.links
      .filter((item) => item?.href)
      .map((item) => ({ label: item?.label || item?.href, href: item?.href }))
    : Object.entries(localMeta?.links || {})
      .filter(([, href]) => typeof href === 'string' && href.trim())
      .map(([key, href]) => ({ label: key, href }));

  return (
    <div
      style={{
        border: '1px solid #00eaff',
        background: 'linear-gradient(145deg, #071319 0%, #0b0b0b 55%, #0f1e24 100%)',
        boxShadow: '0 0 0 1px #09333a inset, 0 0 18px rgba(0, 234, 255, 0.14)',
        padding: '16px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: '#8ff7ff', fontSize: '0.85rem', letterSpacing: '0.04em' }}>FICHA OFICIAL DE LINAJE</div>
          <h3 style={{ margin: '6px 0 0', fontSize: '1.4rem', color: '#d6ffff' }}>{displayName}</h3>
          {localMeta?.subtitle && (
            <div style={{ marginTop: '6px', color: '#8ff7ff', fontSize: '0.95rem' }}>{localMeta.subtitle}</div>
          )}
        </div>
        <div
          style={{
            border: '1px solid #2f6f7a',
            background: '#0a1b20',
            color: '#7dffe4',
            padding: '6px 10px',
            fontSize: '0.85rem',
            fontWeight: 'bold',
            textTransform: 'uppercase',
          }}
        >
          XOLO | RAMIREZ
        </div>
      </div>

      <div
        style={{
          marginTop: '14px',
          border: '1px solid #1c515b',
          background: 'radial-gradient(circle at 20% 20%, #124a55 0%, #0a1b20 45%, #061115 100%)',
          minHeight: '200px',
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
        }}
      >
        {showImage ? (
          <img
            src={mediaUrl}
            alt={imageAlt}
            loading="lazy"
            style={{ width: '100%', height: '100%', maxHeight: '320px', objectFit: 'cover', display: 'block' }}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div style={{ color: '#9bdfff', letterSpacing: '0.12em', fontSize: '1.15rem' }}>
            {placeholderText || 'XOLO'}
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: '14px',
          display: 'grid',
          gap: '10px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        }}
      >
        <Box style={{ background: 'rgba(1, 34, 40, 0.55)', borderColor: '#1c515b', padding: '10px' }}>
          <div style={{ color: '#8ff7ff', fontSize: '0.85rem' }}>Nombre completo</div>
          <strong>{ficha.nombreCompleto}</strong>
        </Box>
        <Box style={{ background: 'rgba(1, 34, 40, 0.55)', borderColor: '#1c515b', padding: '10px' }}>
          <div style={{ color: '#8ff7ff', fontSize: '0.85rem' }}>Afijo</div>
          <strong>{ficha.afijo}</strong>
        </Box>
        <Box style={{ background: 'rgba(1, 34, 40, 0.55)', borderColor: '#1c515b', padding: '10px' }}>
          <div style={{ color: '#8ff7ff', fontSize: '0.85rem' }}>Sexo</div>
          <strong>{ficha.sexo}</strong>
        </Box>
        <Box style={{ background: 'rgba(1, 34, 40, 0.55)', borderColor: '#1c515b', padding: '10px' }}>
          <div style={{ color: '#8ff7ff', fontSize: '0.85rem' }}>Color</div>
          <strong>{ficha.color}</strong>
        </Box>
        <Box style={{ background: 'rgba(1, 34, 40, 0.55)', borderColor: '#1c515b', padding: '10px' }}>
          <div style={{ color: '#8ff7ff', fontSize: '0.85rem' }}>Variedad</div>
          <strong>{ficha.variedad}</strong>
        </Box>
        <Box style={{ background: 'rgba(1, 34, 40, 0.55)', borderColor: '#1c515b', padding: '10px' }}>
          <div style={{ color: '#8ff7ff', fontSize: '0.85rem' }}>Fecha de nacimiento</div>
          <strong>{ficha.fechaNacimiento}</strong>
        </Box>
        <Box style={{ background: 'rgba(1, 34, 40, 0.55)', borderColor: '#1c515b', padding: '10px' }}>
          <div style={{ color: '#8ff7ff', fontSize: '0.85rem' }}>Lugar de nacimiento</div>
          <strong>{ficha.lugarNacimiento}</strong>
        </Box>
        <Box style={{ background: 'rgba(1, 34, 40, 0.55)', borderColor: '#1c515b', padding: '10px' }}>
          <div style={{ color: '#8ff7ff', fontSize: '0.85rem' }}>Criador</div>
          <strong>{ficha.criador}</strong>
        </Box>
      </div>

      <div
        style={{
          marginTop: '10px',
          display: 'grid',
          gap: '10px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        }}
      >
        <Box style={{ background: 'rgba(1, 34, 40, 0.55)', borderColor: '#1c515b', padding: '10px' }}>
          <div style={{ color: '#8ff7ff', fontSize: '0.85rem' }}>Padre</div>
          <strong>{ficha.padre}</strong>
        </Box>
        <Box style={{ background: 'rgba(1, 34, 40, 0.55)', borderColor: '#1c515b', padding: '10px' }}>
          <div style={{ color: '#8ff7ff', fontSize: '0.85rem' }}>Madre</div>
          <strong>{ficha.madre}</strong>
        </Box>
        <Box style={{ background: 'rgba(1, 34, 40, 0.55)', borderColor: '#1c515b', padding: '10px' }}>
          <div style={{ color: '#8ff7ff', fontSize: '0.85rem' }}>Camada</div>
          <strong>{ficha.camada}</strong>
        </Box>
        <Box style={{ background: 'rgba(1, 34, 40, 0.55)', borderColor: '#1c515b', padding: '10px' }}>
          <div style={{ color: '#8ff7ff', fontSize: '0.85rem' }}>Microchip</div>
          <strong>{ficha.microchip}</strong>
        </Box>
        <Box style={{ background: 'rgba(1, 34, 40, 0.55)', borderColor: '#1c515b', padding: '10px' }}>
          <div style={{ color: '#8ff7ff', fontSize: '0.85rem' }}>Registro FCM</div>
          <strong>{ficha.registroFCM}</strong>
        </Box>
        <Box style={{ background: 'rgba(1, 34, 40, 0.55)', borderColor: '#1c515b', padding: '10px' }}>
          <div style={{ color: '#8ff7ff', fontSize: '0.85rem' }}>Estado de entrega</div>
          <strong>{ficha.entregaEstado}</strong>
        </Box>
        <Box style={{ background: 'rgba(1, 34, 40, 0.55)', borderColor: '#1c515b', padding: '10px' }}>
          <div style={{ color: '#8ff7ff', fontSize: '0.85rem' }}>NFT linaje</div>
          <strong>{ficha.nftLinaje}</strong>
        </Box>
      </div>

      <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #17444d' }}>
        {resolvedSlug && (
          <div style={{ color: '#8ff7ff' }}>
            <strong>Slug narrativo:</strong> {resolvedSlug}
          </div>
        )}
        <div style={{ marginTop: '6px', color: '#8ff7ff' }}>
          <strong>Índice local:</strong> {hasIndexedSlug ? 'Vinculado' : 'Sin vínculo'}
        </div>
        <div style={{ marginTop: '6px', color: '#8ff7ff' }}>
          <strong>Capa editorial local:</strong> {localMeta ? 'Disponible' : 'No encontrada'}
        </div>
        <div style={{ color: '#8ff7ff' }}>
          <strong>TXID:</strong> <TxLink txid={tx.txid} />
        </div>
        <div style={{ marginTop: '6px', color: '#8ff7ff' }}>
          <strong>Bloque:</strong>{' '}
          {tx.block?.height !== undefined ? (
            <BlockLink hashOrHeight={tx.block.height}>{tx.block.height}</BlockLink>
          ) : 'Mempool'}
        </div>
        {showDetailLink && (
          <div style={{ marginTop: '8px' }}>
            <Link to={detailPath} style={{ color: '#7dffe4' }}>
              Ver registro individual
            </Link>
          </div>
        )}
      </div>

      {editorialText && (
        <Box style={{ marginTop: '12px', background: 'rgba(1, 34, 40, 0.55)', borderColor: '#1c515b', padding: '10px' }}>
          <div style={{ color: '#8ff7ff', fontSize: '0.85rem', marginBottom: '6px' }}>Capa editorial</div>
          <div style={{ color: '#d6ffff', lineHeight: 1.45 }}>{editorialText}</div>
        </Box>
      )}

      {Array.isArray(localMeta?.tags) && localMeta.tags.length > 0 && (
        <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {localMeta.tags.map((tag) => (
            <span
              key={tag}
              style={{
                border: '1px solid #1c515b',
                background: '#0a1b20',
                color: '#7dffe4',
                padding: '4px 8px',
                fontSize: '0.8rem',
                textTransform: 'uppercase',
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {linkEntries.length > 0 && (
        <div style={{ marginTop: '10px', display: 'grid', gap: '6px' }}>
          {linkEntries.map((item) => (
            <a
              key={`${item?.label || 'link'}-${item?.href || ''}`}
              href={item?.href}
              target="_blank"
              rel="noreferrer"
              style={{ color: '#7dffe4', wordBreak: 'break-word' }}
            >
              {item?.label || item?.href}
            </a>
          ))}
        </div>
      )}

      <details style={{ marginTop: '12px' }}>
        <summary style={{ cursor: 'pointer', color: '#9bdfff' }}>Ver OP_RETURN completo</summary>
        <div
          style={{
            marginTop: '8px',
            padding: '10px',
            border: '1px solid #1c4048',
            background: '#081316',
            color: '#ffd37a',
            wordBreak: 'break-word',
            fontSize: '0.9rem',
          }}
        >
          {opReturnText}
        </div>
      </details>
    </div>
  );
}

function normalizeSexoFilterValue(value) {
  const raw = (value || '').toString().trim().toLowerCase();
  if (!raw) return 'desconocido';
  if (raw === 'h' || raw === 'hembra') return 'hembra';
  if (raw === 'm' || raw === 'macho') return 'macho';
  return 'desconocido';
}

function LinajeGalleryCard({ record }) {
  const sexoMap = { H: 'Hembra', M: 'Macho' };
  const [imageFailed, setImageFailed] = React.useState(false);
  const tx = record?.tx || null;
  const parsed = record?.parsed || null;
  const opReturnText = record?.opReturnText || record?.text || '';
  const resolvedSlug = record?.slug || buildLinajeSlug(parsed);
  const localMeta = record?.editorialMeta || resolveLinajeMeta({ slug: resolvedSlug, txid: tx?.txid });
  const indexedTxid = record?.indexedTxid || (resolvedSlug ? findLinajeTxidBySlug(resolvedSlug) : '');
  const displayName = localMeta?.title || localMeta?.nombreCompleto || parsed?.NOMBRE || 'Sin nombre';
  const displaySexo = localMeta?.sexo || (parsed?.SEXO ? sexoMap[parsed.SEXO] || parsed.SEXO : '—');
  const displayVariedad = localMeta?.variedad || parsed?.VAR || '—';
  const displayColor = localMeta?.color || parsed?.COLOR || '—';
  const hasIndexedSlug = isHex64(indexedTxid);
  const detailPath = resolvedSlug ? `/linaje/${resolvedSlug}` : `/linaje/${tx?.txid || ''}`;
  const mediaUrl = localMeta?.image || localMeta?.coverUrl || localMeta?.avatarUrl || '';
  const placeholderText = localMeta?.imagePlaceholder || (displayName ? displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() : 'XOLO');
  const imageAlt = localMeta?.imageAlt || `Retrato de ${displayName}`;
  const showImage = Boolean(mediaUrl) && !imageFailed;
  const tags = Array.isArray(localMeta?.tags) ? localMeta.tags.filter(Boolean).slice(0, 3) : [];

  return (
    <article
      style={{
        border: '1px solid #00eaff',
        background: 'linear-gradient(145deg, #071319 0%, #0b0b0b 55%, #0f1e24 100%)',
        boxShadow: '0 0 0 1px #09333a inset, 0 0 18px rgba(0, 234, 255, 0.14)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: '140px',
          borderBottom: '1px solid #1c515b',
          background: 'radial-gradient(circle at 20% 20%, #124a55 0%, #0a1b20 45%, #061115 100%)',
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
        }}
      >
        {showImage ? (
          <img
            src={mediaUrl}
            alt={imageAlt}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div style={{ color: '#9bdfff', letterSpacing: '0.12em', fontSize: '0.95rem' }}>
            {placeholderText || 'XOLO'}
          </div>
        )}
      </div>

      <div style={{ padding: '12px' }}>
        <div style={{ color: '#8ff7ff', fontSize: '0.78rem', letterSpacing: '0.05em' }}>
          ARCHIVO DEL LINAJE VIVO
        </div>
        <h3 style={{ margin: '6px 0 0', fontSize: '1.1rem', color: '#d6ffff', lineHeight: 1.2 }}>{displayName}</h3>

        {localMeta?.subtitle && (
          <div style={{ marginTop: '6px', color: '#8ff7ff', fontSize: '0.88rem' }}>{localMeta.subtitle}</div>
        )}

        <div style={{ marginTop: '10px', display: 'grid', gap: '6px', fontSize: '0.9rem', color: '#c3fbff' }}>
          <div><strong style={{ color: '#8ff7ff' }}>Sexo:</strong> {displaySexo}</div>
          <div><strong style={{ color: '#8ff7ff' }}>Variedad:</strong> {displayVariedad}</div>
          <div><strong style={{ color: '#8ff7ff' }}>Color:</strong> {displayColor}</div>
        </div>

        <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <span
            style={{
              border: '1px solid #1c515b',
              background: '#0a1b20',
              color: '#7dffe4',
              padding: '3px 8px',
              fontSize: '0.72rem',
              textTransform: 'uppercase',
            }}
          >
            {hasIndexedSlug ? 'Índice: vinculado' : 'Índice: sin vínculo'}
          </span>
          {resolvedSlug && (
            <span
              style={{
                border: '1px solid #1c515b',
                background: '#0a1b20',
                color: '#7dffe4',
                padding: '3px 8px',
                fontSize: '0.72rem',
              }}
            >
              {resolvedSlug}
            </span>
          )}
        </div>

        {tags.length > 0 && (
          <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {tags.map((tag) => (
              <span
                key={tag}
                style={{
                  border: '1px solid #16424a',
                  color: '#8ff7ff',
                  background: 'rgba(1, 34, 40, 0.55)',
                  padding: '2px 7px',
                  fontSize: '0.72rem',
                }}
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        <div style={{ marginTop: '10px', color: '#8ff7ff', fontSize: '0.8rem' }}>
          <strong>TX:</strong> {tx?.txid ? shortHex(tx.txid, 12, 10) : '—'}
        </div>
        <div style={{ marginTop: '4px', color: '#8ff7ff', fontSize: '0.8rem' }}>
          <strong>Bloque:</strong> {tx?.block?.height !== undefined ? tx.block.height : 'Mempool'}
        </div>

        <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
          <Link to={detailPath} style={{ color: '#7dffe4' }}>
            Abrir ficha
          </Link>
          <details>
            <summary style={{ cursor: 'pointer', color: '#9bdfff', fontSize: '0.85rem' }}>OP_RETURN</summary>
            <div
              style={{
                marginTop: '8px',
                padding: '8px',
                border: '1px solid #1c4048',
                background: '#081316',
                color: '#ffd37a',
                wordBreak: 'break-word',
                fontSize: '0.8rem',
                maxWidth: '420px',
              }}
            >
              {opReturnText || '—'}
            </div>
          </details>
        </div>
      </div>
    </article>
  );
}

function TxLink({ txid }) {
  return (
    <Link to={`/tx/${txid}`} style={{ color: '#00eaff' }}>
      {shortHex(txid, 18, 14)}
    </Link>
  );
}

function BlockLink({ hashOrHeight, children }) {
  return (
    <Link to={`/block/${hashOrHeight}`} style={{ color: '#00eaff' }}>
      {children || hashOrHeight}
    </Link>
  );
}

function AddressLink({ address }) {
  return (
    <Link to={`/address/${encodeURIComponent(address)}`} style={{ color: '#00eaff', wordBreak: 'break-word' }}>
      {address}
    </Link>
  );
}

function TxTable({ txs = [] }) {
  if (!txs.length) return <Box>No hay transacciones.</Box>;

  return (
    <Box style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>TXID</th>
            <th style={thStyle}>Inputs</th>
            <th style={thStyle}>Outputs</th>
            <th style={thStyle}>Bloque</th>
          </tr>
        </thead>
        <tbody>
          {txs.map((tx) => (
            <tr key={tx.txid}>
              <td style={tdStyle}><TxLink txid={tx.txid} /></td>
              <td style={tdStyle}>{formatNumber(tx.inputs?.length || 0)}</td>
              <td style={tdStyle}>{formatNumber(tx.outputs?.length || 0)}</td>
              <td style={tdStyle}>
                {tx.block?.height !== undefined ? (
                  <BlockLink hashOrHeight={tx.block.height}>{tx.block.height}</BlockLink>
                ) : 'Mempool'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}

const thStyle = {
  textAlign: 'left',
  padding: '10px',
  borderBottom: '1px solid #00eaff',
  color: '#8ff7ff',
};

const tdStyle = {
  padding: '10px',
  borderBottom: '1px solid #123',
  verticalAlign: 'top',
};

function OutputsTable({ outputs = [] }) {
  if (!outputs.length) return <Box>No hay salidas.</Box>;

  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      {outputs.map((output, idx) => {
        const addr = outputScriptToAddress(output.outputScript);
        const opReturn = isOpReturn(output.outputScript);
        const opReturnText = extractOpReturnText(output.outputScript);

        return (
          <Box key={idx}>
            <div><strong>Output #{idx}</strong></div>
            <div style={{ marginTop: '8px' }}>Valor: {satsToXec(output.sats)}</div>

            {addr && (
              <div style={{ marginTop: '8px' }}>
                Dirección: <AddressLink address={addr} />
              </div>
            )}

            {opReturn && (
              <div style={{ marginTop: '8px', color: '#ffd37a' }}>
                OP_RETURN detectado
                <div style={{ marginTop: '6px', wordBreak: 'break-word' }}>
                  {opReturnText}
                </div>
                {isXolosLinajeRecord(opReturnText) && (
                  <div style={{ marginTop: '8px', color: '#9dff9d' }}>
                    🐾 Registro oficial de linaje detectado
                  </div>
                )}
              </div>
            )}

            {!addr && !opReturn && (
              <div style={{ marginTop: '8px', color: '#8ff7ff', wordBreak: 'break-word' }}>
                Script: {output.outputScript || '—'}
              </div>
            )}
          </Box>
        );
      })}
    </div>
  );
}

function InputsTable({ inputs = [] }) {
  if (!inputs.length) return <Box>No hay inputs.</Box>;

  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      {inputs.map((input, idx) => (
        <Box key={idx}>
          <div><strong>Input #{idx}</strong></div>
          {input.prevOut?.txid ? (
            <div style={{ marginTop: '8px' }}>
              Prev TX: <TxLink txid={input.prevOut.txid} />
              <div style={{ marginTop: '6px', color: '#b8fdff' }}>
                Output index: {input.prevOut.outIdx}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: '8px', color: '#b8fdff' }}>Coinbase / sin prevOut</div>
          )}

          {input.sats !== undefined && (
            <div style={{ marginTop: '8px' }}>
              Valor origen: {satsToXec(input.sats)}
            </div>
          )}
        </Box>
      ))}
    </div>
  );
}

function HomePage() {
  return (
    <Shell>
      <SearchBar />
      <StatGrid
        items={[
          { label: 'Ruta Explorer', value: <Link to="/explorer" style={{ color: '#00eaff' }}>/explorer</Link> },
          { label: 'Ruta Linaje', value: <Link to="/linaje" style={{ color: '#00eaff' }}>/linaje</Link> },
          { label: 'Bloque ejemplo', value: <Link to="/block/9000" style={{ color: '#00eaff' }}>/block/9000</Link> },
        ]}
      />
    </Shell>
  );
}

function ExplorerPage() {
  const [state, setState] = React.useState({
    loading: true,
    error: '',
    blocks: [],
    txs: [],
  });

  React.useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        setState({ loading: true, error: '', blocks: [], txs: [] });

        const tip = await chronik.blockchainInfo();
        const tipHeight = tip.tipHeight;

        const heights = [];
        for (let h = tipHeight; h > Math.max(0, tipHeight - 9); h--) {
          heights.push(h);
        }

        const blockResults = await Promise.all(
          heights.map((h) => chronik.block(h.toString()))
        );

        const txResults = await Promise.all(
          heights.slice(0, 5).map((h) => chronik.blockTxs(h.toString(), 0, 5))
        );

        const flatTxs = txResults.flatMap((r) => r.txs || []);

        if (mounted) {
          setState({
            loading: false,
            error: '',
            blocks: blockResults,
            txs: flatTxs,
          });
        }
      } catch (err) {
        if (mounted) {
          setState({
            loading: false,
            error: err?.message || 'No se pudo cargar el explorer.',
            blocks: [],
            txs: [],
          });
        }
      }
    }

    load();
    return () => { mounted = false; };
  }, []);

  return (
    <Shell>
      <SearchBar />
      {state.loading && <LoadingBox text="Cargando dashboard del explorador..." />}
      {state.error && <ErrorBox error={state.error} />}

      {!state.loading && !state.error && (
        <>
          <SectionTitle>Últimos bloques</SectionTitle>
          <Box style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Altura</th>
                  <th style={thStyle}>Hash</th>
                  <th style={thStyle}>Fecha</th>
                  <th style={thStyle}>TXs</th>
                  <th style={thStyle}>Tamaño</th>
                </tr>
              </thead>
              <tbody>
                {state.blocks.map((b) => {
                  const info = b.blockInfo;
                  return (
                    <tr key={info.hash}>
                      <td style={tdStyle}>
                        <BlockLink hashOrHeight={info.height}>{info.height}</BlockLink>
                      </td>
                      <td style={tdStyle}>{shortHex(info.hash, 18, 14)}</td>
                      <td style={tdStyle}>{unixToText(info.timestamp)}</td>
                      <td style={tdStyle}>{formatNumber(info.numTxs)}</td>
                      <td style={tdStyle}>{formatNumber(info.blockSize)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Box>

          <SectionTitle>Últimas transacciones</SectionTitle>
          <TxTable txs={state.txs} />
        </>
      )}
    </Shell>
  );
}

function LinajePage() {
  const [state, setState] = React.useState({
    loading: true,
    error: '',
    matches: [],
  });
  const [query, setQuery] = React.useState('');
  const [sexoFilter, setSexoFilter] = React.useState('todos');
  const [variedadFilter, setVariedadFilter] = React.useState('todas');
  const [onlyIndexed, setOnlyIndexed] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        setState({ loading: true, error: '', matches: [] });
        const matches = await fetchRecentLinajeMatches(20, 25);

        if (mounted) {
          setState({ loading: false, error: '', matches });
        }
      } catch (err) {
        if (mounted) {
          setState({
            loading: false,
            error: err?.message || 'No se pudo cargar la vista de linaje.',
            matches: [],
          });
        }
      }
    }

    load();
    return () => { mounted = false; };
  }, []);

  const records = React.useMemo(() => {
    const flattened = state.matches.flatMap(({ tx, opReturns }) =>
      opReturns.map((op, i) => {
        const enriched = enrichLinajeRecord(op, tx.txid);
        const localMeta = enriched.editorialMeta || resolveLinajeMeta({ slug: enriched.slug, txid: tx.txid });
        const sexoValue = localMeta?.sexo || enriched.parsed?.SEXO || '';
        const variedadValue = localMeta?.variedad || enriched.parsed?.VAR || '';
        const tags = Array.isArray(localMeta?.tags) ? localMeta.tags.join(' ') : '';
        const searchText = [
          enriched.slug,
          tx.txid,
          localMeta?.title,
          localMeta?.nombreCompleto,
          localMeta?.subtitle,
          localMeta?.color,
          localMeta?.variedad,
          localMeta?.sexo,
          enriched.parsed?.NOMBRE,
          enriched.parsed?.COLOR,
          enriched.parsed?.VAR,
          enriched.parsed?.SEXO,
          tags,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return {
          id: `${tx.txid}-${i}`,
          tx,
          index: i,
          parsed: enriched.parsed,
          slug: enriched.slug,
          indexedTxid: enriched.indexedTxid,
          editorialMeta: localMeta,
          opReturnText: enriched.text,
          sexoFilter: normalizeSexoFilterValue(sexoValue),
          variedadFilter: (variedadValue || '').toString().trim().toLowerCase(),
          hasIndexedSlug: isHex64(enriched.indexedTxid),
          searchText,
        };
      })
    );

    return flattened.sort((a, b) => {
      const heightA = a.tx?.block?.height ?? -1;
      const heightB = b.tx?.block?.height ?? -1;
      if (heightA !== heightB) return heightB - heightA;
      return a.index - b.index;
    });
  }, [state.matches]);

  const variedadOptions = React.useMemo(() => {
    const raw = Array.from(new Set(records.map((record) => record.variedadFilter).filter(Boolean))).sort();
    return raw;
  }, [records]);

  const filteredRecords = React.useMemo(() => {
    const q = query.trim().toLowerCase();

    return records.filter((record) => {
      if (q && !record.searchText.includes(q)) return false;
      if (sexoFilter !== 'todos' && record.sexoFilter !== sexoFilter) return false;
      if (variedadFilter !== 'todas' && record.variedadFilter !== variedadFilter) return false;
      if (onlyIndexed && !record.hasIndexedSlug) return false;
      return true;
    });
  }, [records, query, sexoFilter, variedadFilter, onlyIndexed]);

  return (
    <Shell>
      <SearchBar />
      <SectionTitle>Archivo del Linaje Vivo</SectionTitle>

      {state.loading && <LoadingBox text="Buscando inscripciones OP_RETURN..." />}
      {state.error && <ErrorBox error={state.error} />}

      {!state.loading && !state.error && (
        <>
          {state.matches.length === 0 ? (
            <Box>No se encontraron registros oficiales de linaje en el rango escaneado.</Box>
          ) : (
            <>
              <Box style={{ marginBottom: '14px' }}>
                <div
                  style={{
                    display: 'grid',
                    gap: '10px',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    alignItems: 'end',
                  }}
                >
                  <label style={{ display: 'grid', gap: '6px', color: '#8ff7ff', fontSize: '0.85rem' }}>
                    Buscar
                    <input
                      type="text"
                      placeholder="Nombre, slug, txid, color..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      style={{
                        background: '#081316',
                        border: '1px solid #1c515b',
                        color: '#d6ffff',
                        padding: '8px 10px',
                        fontFamily: 'monospace',
                      }}
                    />
                  </label>

                  <label style={{ display: 'grid', gap: '6px', color: '#8ff7ff', fontSize: '0.85rem' }}>
                    Sexo
                    <select
                      value={sexoFilter}
                      onChange={(e) => setSexoFilter(e.target.value)}
                      style={{
                        background: '#081316',
                        border: '1px solid #1c515b',
                        color: '#d6ffff',
                        padding: '8px 10px',
                        fontFamily: 'monospace',
                      }}
                    >
                      <option value="todos">Todos</option>
                      <option value="hembra">Hembra</option>
                      <option value="macho">Macho</option>
                      <option value="desconocido">Desconocido</option>
                    </select>
                  </label>

                  <label style={{ display: 'grid', gap: '6px', color: '#8ff7ff', fontSize: '0.85rem' }}>
                    Variedad
                    <select
                      value={variedadFilter}
                      onChange={(e) => setVariedadFilter(e.target.value)}
                      style={{
                        background: '#081316',
                        border: '1px solid #1c515b',
                        color: '#d6ffff',
                        padding: '8px 10px',
                        fontFamily: 'monospace',
                      }}
                    >
                      <option value="todas">Todas</option>
                      {variedadOptions.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#8ff7ff', fontSize: '0.85rem' }}>
                    <input
                      type="checkbox"
                      checked={onlyIndexed}
                      onChange={(e) => setOnlyIndexed(e.target.checked)}
                    />
                    Solo con vínculo en índice local
                  </label>
                </div>

                <div style={{ marginTop: '10px', color: '#8ff7ff' }}>
                  Mostrando <strong>{filteredRecords.length}</strong> de <strong>{records.length}</strong> registros
                </div>
              </Box>

              {filteredRecords.length === 0 ? (
                <Box>No hay registros que coincidan con los filtros aplicados.</Box>
              ) : (
                <div style={{ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                  {filteredRecords.map((record) => (
                    <LinajeGalleryCard key={record.id} record={record} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </Shell>
  );
}

function LinajeRecordPage() {
  const { txidOrSlug } = useParams();
  const [state, setState] = React.useState({
    loading: true,
    error: '',
    tx: null,
    records: [],
    resolvedBy: '',
  });

  React.useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        setState({ loading: true, error: '', tx: null, records: [], resolvedBy: '' });
        const value = (txidOrSlug || '').trim();

        if (!value) {
          throw new Error('Falta identificar un txid o slug de linaje.');
        }

        if (isHex64(value)) {
          const tx = await chronik.tx(value);
          const records = extractLinajeRecordsFromTx(tx);

          if (!records.length) {
            throw new Error('La transacción existe, pero no contiene un registro oficial de linaje XOLO|RAMIREZ.');
          }

          if (mounted) {
            setState({ loading: false, error: '', tx, records, resolvedBy: 'txid' });
          }
          return;
        }

        const slug = slugify(value);
        const indexedTxid = findLinajeTxidBySlug(slug);

        if (isHex64(indexedTxid)) {
          const tx = await chronik.tx(indexedTxid);
          const records = extractLinajeRecordsFromTx(tx);
          const matchedRecord = records.find((record) => record.slug === slug);

          if (matchedRecord) {
            if (mounted) {
              setState({
                loading: false,
                error: '',
                tx,
                records: [matchedRecord],
                resolvedBy: 'slug-index',
              });
            }
            return;
          }
        }

        const matches = await fetchRecentLinajeMatches(250, 25);
        const flattened = matches.flatMap(({ tx, opReturns }) =>
          opReturns.map((record) => ({ tx, record }))
        );
        const found = flattened.find(({ record }) => record.slug === slug);

        if (!found) {
          throw new Error(`No se encontró un registro de linaje para el slug "${value}" en el índice local ni en el rango escaneado.`);
        }

        if (mounted) {
          setState({
            loading: false,
            error: '',
            tx: found.tx,
            records: [found.record],
            resolvedBy: 'slug-scan',
          });
        }
      } catch (err) {
        if (mounted) {
          setState({
            loading: false,
            error: err?.message || 'No se pudo cargar el registro de linaje.',
            tx: null,
            records: [],
            resolvedBy: '',
          });
        }
      }
    }

    load();
    return () => { mounted = false; };
  }, [txidOrSlug]);

  return (
    <Shell>
      <SearchBar />
      <SectionTitle>Registro Individual del Linaje Vivo</SectionTitle>
      <div style={{ marginTop: '6px' }}>
        <Link to="/linaje" style={{ color: '#00eaff' }}>
          ← Volver al archivo de linaje
        </Link>
      </div>

      {state.loading && <LoadingBox text="Cargando registro individual..." />}
      {state.error && <ErrorBox error={state.error} />}

      {!state.loading && !state.error && state.tx && (
        <>
          {/*
            La vista individual unifica:
            1) OP_RETURN parseado (records),
            2) slug/índice local,
            3) metadata editorial local.
          */}
          {(() => {
            const primary = state.records[0] || null;
            const enriched = primary ? enrichLinajeRecord(primary, state.tx.txid) : null;
            return (
          <StatGrid
            items={[
              { label: 'TXID', value: state.tx.txid },
              { label: 'Resuelto por', value: state.resolvedBy || '—' },
              { label: 'Slug narrativo', value: enriched?.slug || '—' },
              { label: 'Índice local', value: isHex64(enriched?.indexedTxid || '') ? 'Vinculado' : 'Sin vínculo' },
              { label: 'Capa editorial', value: enriched?.editorialMeta ? 'Disponible' : 'No encontrada' },
              {
                label: 'Bloque',
                value: state.tx.block?.height !== undefined ? (
                  <BlockLink hashOrHeight={state.tx.block.height}>{state.tx.block.height}</BlockLink>
                ) : 'Mempool',
              },
              { label: 'Registros oficiales en TX', value: formatNumber(state.records.length) },
            ]}
          />
            );
          })()}

          <div style={{ marginTop: '14px', display: 'grid', gap: '14px' }}>
            {state.records.map((record, i) => {
              const enriched = enrichLinajeRecord(record, state.tx.txid);
              return (
                <LinajeCard
                  key={`${state.tx.txid}-${i}`}
                  tx={state.tx}
                  opReturnText={enriched.text}
                  parsed={enriched.parsed}
                  slug={enriched.slug}
                  indexedTxid={enriched.indexedTxid}
                  editorialMeta={enriched.editorialMeta}
                  showDetailLink={false}
                />
              );
            })}
          </div>
        </>
      )}
    </Shell>
  );
}

function BlockPage() {
  const { height } = useParams();
  const [state, setState] = React.useState({ loading: true, error: '', data: null });

  React.useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setState({ loading: true, error: '', data: null });
        const [block, txs] = await Promise.all([
          chronik.block(height),
          chronik.blockTxs(height, 0, 25),
        ]);
        if (mounted) setState({ loading: false, error: '', data: { block, txs } });
      } catch (err) {
        if (mounted) setState({ loading: false, error: err?.message || 'No se pudo cargar el bloque.', data: null });
      }
    }
    load();
    return () => { mounted = false; };
  }, [height]);

  const info = state.data?.block?.blockInfo;

  return (
    <Shell>
      <SearchBar />
      <div style={{ marginTop: '20px', color: '#8ff7ff' }}>
        Viendo bloque: <strong>{height}</strong>
      </div>

      {state.loading && <LoadingBox />}
      {state.error && <ErrorBox error={state.error} />}

      {state.data && (
        <>
          <StatGrid
            items={[
              { label: 'Altura', value: info?.height },
              { label: 'Hash', value: info?.hash },
              { label: 'Fecha', value: unixToText(info?.timestamp) },
              { label: 'TXs', value: formatNumber(info?.numTxs) },
              { label: 'Tamaño', value: formatNumber(info?.blockSize) },
              { label: 'Bits', value: formatNumber(info?.nBits) },
              {
                label: 'Bloque anterior',
                value: info?.height > 0 ? <BlockLink hashOrHeight={info.height - 1}>{info.height - 1}</BlockLink> : '—',
              },
              {
                label: 'Bloque siguiente',
                value: <BlockLink hashOrHeight={info.height + 1}>{info.height + 1}</BlockLink>,
              },
            ]}
          />

          <SectionTitle>Transacciones del bloque</SectionTitle>
          <TxTable txs={state.data?.txs?.txs || []} />
        </>
      )}
    </Shell>
  );
}

function TxPage() {
  const { txid } = useParams();
  const [state, setState] = React.useState({ loading: true, error: '', data: null });

  React.useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setState({ loading: true, error: '', data: null });
        const tx = await chronik.tx(txid);
        if (mounted) setState({ loading: false, error: '', data: tx });
      } catch (err) {
        if (mounted) setState({ loading: false, error: err?.message || 'No se pudo cargar la transacción.', data: null });
      }
    }
    load();
    return () => { mounted = false; };
  }, [txid]);

  const tx = state.data;

  return (
    <Shell>
      <SearchBar />
      <div style={{ marginTop: '20px', color: '#8ff7ff' }}>
        Viendo transacción: <strong>{shortHex(txid, 20, 16)}</strong>
      </div>

      {state.loading && <LoadingBox />}
      {state.error && <ErrorBox error={state.error} />}

      {tx && (
        <>
          <StatGrid
            items={[
              { label: 'TXID', value: tx.txid },
              { label: 'Inputs', value: formatNumber(tx.inputs?.length || 0) },
              { label: 'Outputs', value: formatNumber(tx.outputs?.length || 0) },
              { label: 'Primera vez vista', value: unixToText(tx.timeFirstSeen) },
              {
                label: 'Bloque',
                value: tx.block?.height !== undefined ? (
                  <BlockLink hashOrHeight={tx.block.height}>{tx.block.height}</BlockLink>
                ) : 'Mempool',
              },
            ]}
          />

          <SectionTitle>Inputs</SectionTitle>
          <InputsTable inputs={tx.inputs || []} />

          <SectionTitle>Outputs</SectionTitle>
          <OutputsTable outputs={tx.outputs || []} />
        </>
      )}
    </Shell>
  );
}

function AddressPage() {
  const { address } = useParams();
  const decodedAddress = decodeURIComponent(address || '');
  const [state, setState] = React.useState({ loading: true, error: '', data: null });

  React.useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setState({ loading: true, error: '', data: null });
        const [history, utxos] = await Promise.all([
          chronik.address(decodedAddress).history(0, 25),
          chronik.address(decodedAddress).utxos(),
        ]);
        if (mounted) setState({ loading: false, error: '', data: { history, utxos } });
      } catch (err) {
        if (mounted) setState({ loading: false, error: err?.message || 'No se pudo cargar la dirección.', data: null });
      }
    }
    load();
    return () => { mounted = false; };
  }, [decodedAddress]);

  const utxos = state.data?.utxos?.utxos || [];
  const txs = state.data?.history?.txs || [];
  const totalSats = utxos.reduce((acc, u) => acc + Number(u.sats || 0), 0);

  return (
    <Shell>
      <SearchBar />
      <div style={{ marginTop: '20px', color: '#8ff7ff', wordBreak: 'break-word' }}>
        Viendo dirección: <strong>{decodedAddress}</strong>
      </div>

      {state.loading && <LoadingBox />}
      {state.error && <ErrorBox error={state.error} />}

      {state.data && (
        <>
          <StatGrid
            items={[
              { label: 'Dirección', value: decodedAddress },
              { label: 'UTXOs', value: formatNumber(utxos.length) },
              { label: 'TXs cargadas', value: formatNumber(txs.length) },
              { label: 'Balance visible', value: satsToXec(totalSats) },
            ]}
          />

          <SectionTitle>Historial reciente</SectionTitle>
          <TxTable txs={txs} />
        </>
      )}
    </Shell>
  );
}

function TokenPage() {
  const { tokenId } = useParams();
  const [state, setState] = React.useState({ loading: true, error: '', data: null });

  React.useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setState({ loading: true, error: '', data: null });
        const token = await chronik.token(tokenId);
        if (mounted) setState({ loading: false, error: '', data: token });
      } catch (err) {
        if (mounted) setState({ loading: false, error: err?.message || 'No se pudo cargar el token.', data: null });
      }
    }
    load();
    return () => { mounted = false; };
  }, [tokenId]);

  const token = state.data;

  return (
    <Shell>
      <SearchBar />
      <div style={{ marginTop: '20px', color: '#8ff7ff', wordBreak: 'break-word' }}>
        Viendo token: <strong>{shortHex(tokenId, 20, 16)}</strong>
      </div>

      {state.loading && <LoadingBox />}
      {state.error && <ErrorBox error={state.error} />}

      {token && (
        <StatGrid
          items={[
            { label: 'Token ID', value: token.tokenId || tokenId },
            { label: 'Ticker', value: token.tokenTicker || '—' },
            { label: 'Nombre', value: token.tokenName || '—' },
            { label: 'Decimales', value: token.decimals ?? '—' },
            { label: 'URL', value: token.url || '—' },
          ]}
        />
      )}
    </Shell>
  );
}

function SearchHashPage() {
  const { hash } = useParams();
  const navigate = useNavigate();
  const [state, setState] = React.useState({ loading: true, error: '' });

  React.useEffect(() => {
    let mounted = true;
    async function resolveHash() {
      try {
        setState({ loading: true, error: '' });

        try {
          await chronik.tx(hash);
          if (mounted) navigate(`/tx/${hash}`, { replace: true });
          return;
        } catch {}

        try {
          await chronik.block(hash);
          if (mounted) navigate(`/block/${hash}`, { replace: true });
          return;
        } catch {}

        await chronik.token(hash);
        if (mounted) navigate(`/token/${hash}`, { replace: true });
      } catch (err) {
        if (mounted) setState({ loading: false, error: err?.message || 'Hash no encontrado.' });
      }
    }
    resolveHash();
    return () => { mounted = false; };
  }, [hash, navigate]);

  return (
    <Shell>
      <SearchBar />
      {state.loading && <LoadingBox text="Resolviendo hash..." />}
      {state.error && <ErrorBox error={state.error} />}
    </Shell>
  );
}

function NotFoundPage() {
  return (
    <Shell>
      <SearchBar />
      <ErrorBox error="Ruta no encontrada." />
    </Shell>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/explorer" element={<ExplorerPage />} />
        <Route path="/linaje" element={<LinajePage />} />
        <Route path="/linaje/:txidOrSlug" element={<LinajeRecordPage />} />
        <Route path="/block/:height" element={<BlockPage />} />
        <Route path="/tx/:txid" element={<TxPage />} />
        <Route path="/address/:address" element={<AddressPage />} />
        <Route path="/token/:tokenId" element={<TokenPage />} />
        <Route path="/search/:hash" element={<SearchHashPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
