import React, { useMemo, useState } from 'react';
import { BrowserRouter, Link, NavLink, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { ChronikClient } from 'chronik-client';
import * as ecashaddr from 'ecashaddrjs';
import { findLinajeTxidBySlug } from './data/linajeIndex';
import { LINAJE_EDITORIAL_META, resolveLinajeMeta } from './data/linajeMeta';

const CHRONIK_URL = 'https://chronik.xolosarmy.xyz';
const chronik = new ChronikClient(CHRONIK_URL);
const RMZ_TOKEN_ID = (import.meta.env.VITE_RMZ_TOKEN_ID || '').trim().toLowerCase();

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

function toBigIntSafe(value) {
  try {
    if (value === undefined || value === null || value === '') return 0n;
    if (typeof value === 'bigint') return value;
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function formatTokenAmount(value) {
  return new Intl.NumberFormat('es-MX').format(toBigIntSafe(value));
}

function formatTokenAmountWithDecimals(value, decimals) {
  const atoms = toBigIntSafe(value);
  const safeDecimals = Number.isFinite(Number(decimals)) ? Math.max(0, Number(decimals)) : 0;
  if (safeDecimals === 0) return formatTokenAmount(atoms);

  const negative = atoms < 0n;
  const absAtoms = negative ? -atoms : atoms;
  const base = 10n ** BigInt(safeDecimals);
  const whole = absAtoms / base;
  const fraction = (absAtoms % base).toString().padStart(safeDecimals, '0').replace(/0+$/, '');
  const wholeText = new Intl.NumberFormat('es-MX').format(whole);

  return `${negative ? '-' : ''}${wholeText}${fraction ? `.${fraction}` : ''}`;
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

const navLinkStyle = ({ isActive }) => ({
  color: isActive ? '#050505' : '#7ce9f4',
  textDecoration: 'none',
  border: `1px solid ${isActive ? '#00eaff' : '#194a52'}`,
  background: isActive ? '#00eaff' : '#09181d',
  padding: '8px 12px',
  fontSize: '0.88rem',
  letterSpacing: '0.03em',
});

function GlobalNav() {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        marginBottom: '24px',
        paddingBottom: '12px',
        borderBottom: '1px solid #17454e',
        background: 'linear-gradient(180deg, rgba(5,5,5,0.98) 0%, rgba(5,5,5,0.9) 100%)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <Link to="/" style={{ color: '#00eaff', textDecoration: 'none', fontWeight: 'bold', letterSpacing: '0.04em' }}>
          XOLOS EXPLORER
        </Link>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <NavLink to="/" end style={navLinkStyle}>Home</NavLink>
          <NavLink to="/explorer" style={navLinkStyle}>Explorer</NavLink>
          <NavLink to="/linaje" style={navLinkStyle}>Linaje</NavLink>
          <NavLink to="/collection/xolosnft" style={navLinkStyle}>Colección</NavLink>
          <NavLink to="/status" style={navLinkStyle}>Nodo</NavLink>
        </div>
      </div>
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
        padding: '22px',
        fontFamily: 'monospace',
      }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <GlobalNav />
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

function TokenLink({ tokenId, children }) {
  return (
    <Link to={`/token/${tokenId}`} style={{ color: '#00eaff', wordBreak: 'break-word' }}>
      {children || shortHex(tokenId, 18, 14)}
    </Link>
  );
}

function normalizeMediaUrl(value) {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('ipfs://')) {
    const path = trimmed.slice('ipfs://'.length).replace(/^ipfs\//, '');
    return `https://ipfs.io/ipfs/${path}`;
  }
  return trimmed;
}

function extractImageLikeField(input) {
  if (!input) return '';
  if (typeof input === 'string') {
    const text = input.trim();
    const seemsImage = /^data:image\//i.test(text)
      || /\.(png|jpg|jpeg|webp|gif|avif|svg)(\?|#|$)/i.test(text)
      || /image|thumbnail|cover|avatar|icon|logo|art/i.test(text);
    return seemsImage ? normalizeMediaUrl(text) : '';
  }
  if (Array.isArray(input)) {
    for (const value of input) {
      const found = extractImageLikeField(value);
      if (found) return found;
    }
    return '';
  }
  if (typeof input === 'object') {
    const candidateKeys = [
      'image', 'imageUrl', 'imageURL', 'imageUri', 'imageURI',
      'cover', 'coverUrl', 'coverURL',
      'thumbnail', 'thumbnailUrl', 'thumbnailURL',
      'avatar', 'avatarUrl', 'avatarURL',
      'icon', 'iconUrl', 'iconURL',
      'logo', 'logoUrl', 'logoURL',
      'artwork', 'artworkUrl', 'previewImage',
      'url', 'uri',
    ];
    for (const key of candidateKeys) {
      if (key in input) {
        const found = extractImageLikeField(input[key]);
        if (found) return found;
      }
    }
  }
  return '';
}

function buildCollectibleInitials(label, tokenId) {
  const base = (label || '').trim();
  if (base) {
    const tokens = base.split(/\s+/).filter(Boolean);
    if (tokens.length > 1) return `${tokens[0][0] || ''}${tokens[1][0] || ''}`.toUpperCase();
    return base.slice(0, 2).toUpperCase();
  }
  return shortHex(tokenId, 2, 0).toUpperCase();
}

const XOLO_ARCHIVE_THEME_KEYS = Object.freeze(['obsidian', 'codex', 'jade', 'ritual', 'neon']);

function normalizeXoloArchiveTheme(value) {
  if (!value || typeof value !== 'string') return 'codex';
  const normalized = value.trim().toLowerCase();
  return XOLO_ARCHIVE_THEME_KEYS.includes(normalized) ? normalized : 'codex';
}

function buildXoloArchiveThemeStyles(theme = 'codex', accent = '') {
  const themes = {
    obsidian: {
      border: '#555b74',
      articleBg: 'linear-gradient(165deg, #08090d 0%, #121722 54%, #1a2234 100%)',
      articleShadow: '0 0 0 1px #2f3a58 inset, 0 0 34px rgba(120, 142, 201, 0.2)',
      frameBorder: '#4f5f8c',
      frameBg: 'radial-gradient(circle at 16% 10%, #3b4669 0%, #181f2f 45%, #0b0d12 100%)',
      label: '#adb8e0',
      value: '#eef1ff',
      panelBg: 'rgba(15, 18, 28, 0.82)',
      panelTitle: '#cad5ff',
      narrative: '#e6ecff',
      linkBorder: '#7588cc',
      linkBg: '#172039',
      linkColor: '#e8eeff',
      breadcrumb: '#beccff',
      placeholder: '#e8eeff',
    },
    codex: {
      border: '#00eaff',
      articleBg: 'linear-gradient(165deg, #050e13 0%, #0a1a22 48%, #0d2731 100%)',
      articleShadow: '0 0 0 1px #103d46 inset, 0 0 34px rgba(0, 234, 255, 0.16)',
      frameBorder: '#1f6570',
      frameBg: 'radial-gradient(circle at 20% 15%, #1a5d66 0%, #0d1d24 46%, #061015 100%)',
      label: '#79ced6',
      value: '#d7fbff',
      panelBg: 'rgba(7, 24, 30, 0.72)',
      panelTitle: '#86eaf2',
      narrative: '#caf9ff',
      linkBorder: '#2abfce',
      linkBg: '#0a1c22',
      linkColor: '#b4fbff',
      breadcrumb: '#7dffe4',
      placeholder: '#9feeff',
    },
    jade: {
      border: '#46c08a',
      articleBg: 'linear-gradient(160deg, #05110b 0%, #0e2718 50%, #1e3a24 100%)',
      articleShadow: '0 0 0 1px #205437 inset, 0 0 34px rgba(70, 192, 138, 0.2)',
      frameBorder: '#3f9368',
      frameBg: 'radial-gradient(circle at 24% 12%, #4aa778 0%, #1d3a28 48%, #08140d 100%)',
      label: '#9de4bf',
      value: '#e2ffe8',
      panelBg: 'rgba(11, 34, 21, 0.78)',
      panelTitle: '#84f2bd',
      narrative: '#d4ffe5',
      linkBorder: '#4cb87f',
      linkBg: '#0f2c1d',
      linkColor: '#d9ffe5',
      breadcrumb: '#8ff8c3',
      placeholder: '#d9ffe5',
    },
    ritual: {
      border: '#d2b56c',
      articleBg: 'linear-gradient(160deg, #120b04 0%, #26170b 52%, #3f2a16 100%)',
      articleShadow: '0 0 0 1px #624321 inset, 0 0 34px rgba(223, 187, 104, 0.24)',
      frameBorder: '#94703a',
      frameBg: 'radial-gradient(circle at 20% 10%, #ba9650 0%, #47301a 50%, #1a0f08 100%)',
      label: '#efd9a6',
      value: '#fff3d3',
      panelBg: 'rgba(39, 24, 11, 0.76)',
      panelTitle: '#ffd68e',
      narrative: '#ffeec2',
      linkBorder: '#c89f51',
      linkBg: '#2c1a0e',
      linkColor: '#ffe7b3',
      breadcrumb: '#ffd98f',
      placeholder: '#ffe7b3',
    },
    neon: {
      border: '#4cff8f',
      articleBg: 'linear-gradient(164deg, #040d10 0%, #0a1d2a 44%, #1a1240 100%)',
      articleShadow: '0 0 0 1px #345f7a inset, 0 0 34px rgba(76, 255, 143, 0.2)',
      frameBorder: '#45bb93',
      frameBg: 'radial-gradient(circle at 22% 11%, #53ffb5 0%, #15374a 45%, #09071a 100%)',
      label: '#8dffd4',
      value: '#ddffec',
      panelBg: 'rgba(8, 27, 38, 0.78)',
      panelTitle: '#82ffd0',
      narrative: '#d5ffee',
      linkBorder: '#42e2ad',
      linkBg: '#0e2230',
      linkColor: '#d5ffee',
      breadcrumb: '#88ffd0',
      placeholder: '#d5ffee',
    },
  };
  const palette = themes[normalizeXoloArchiveTheme(theme)] || themes.codex;
  const accentColor = typeof accent === 'string' && accent.trim() ? accent.trim() : palette.border;
  return {
    ...palette,
    border: accentColor,
    linkBorder: accentColor,
    breadcrumb: accentColor,
  };
}

function buildXoloNftCollectionItems() {
  return Object.entries(LINAJE_EDITORIAL_META || {})
    .map(([metaSlug, meta]) => {
      if (!meta || typeof meta !== 'object') return null;

      const normalizedSlug = slugify(metaSlug || meta.slug || '');
      const indexedTxid = normalizedSlug ? findLinajeTxidBySlug(normalizedSlug) : '';
      const tokenIdCandidate = [
        meta.tokenId,
        meta.nftTokenId,
        meta.token?.tokenId,
        meta.txid,
        indexedTxid,
      ].find((value) => isHex64((value || '').toString().trim()));
      const tokenId = tokenIdCandidate ? tokenIdCandidate.toString().trim().toLowerCase() : '';
      const title = meta.title || meta.nombreCompleto || normalizedSlug || 'Sin titulo';
      const subtitle = meta.subtitle && meta.subtitle !== title ? meta.subtitle : '';
      const narrative = meta.narrative || meta.nota || meta.subtitle || '';
      const tokenSymbol = meta.tokenSymbol || meta.symbol || meta.tokenTicker || '';
      const tokenName = meta.tokenName || meta.name || meta.token?.tokenName || '';
      const lineageRef = normalizedSlug || (isHex64(meta.txid || '') ? meta.txid : '');
      const theme = normalizeXoloArchiveTheme(meta.theme);
      const accent = typeof meta.accent === 'string' ? meta.accent.trim() : '';
      const backgroundNote = typeof meta.backgroundNote === 'string' ? meta.backgroundNote.trim() : '';

      return {
        id: `${normalizedSlug || tokenId || title}`,
        title,
        subtitle,
        slug: normalizedSlug,
        tokenId,
        tokenSymbol,
        tokenName,
        narrative,
        lineageRef,
        theme,
        accent,
        backgroundNote,
        imageUrl: extractImageLikeField(meta),
        imageAlt: meta.imageAlt || `Imagen de ${title}`,
        searchText: `${title} ${subtitle} ${normalizedSlug} ${tokenSymbol} ${tokenName} ${narrative}`.toLowerCase(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }));
}

function NftCollectibleCard({ item }) {
  const [imageFailed, setImageFailed] = React.useState(false);
  const primaryTitle = item.symbol || item.name || shortHex(item.tokenId, 10, 8);
  const secondaryTitle = item.name && item.name !== item.symbol ? item.name : '';
  const quantityLabel = toBigIntSafe(item.amount) === 1n ? '1 collectible' : `Cantidad: ${item.humanBalance}`;
  const lineageSlug = typeof item.editorialMeta?.slug === 'string' ? item.editorialMeta.slug.trim() : '';
  const lineageTxid = typeof item.editorialMeta?.txid === 'string' ? item.editorialMeta.txid.trim() : '';
  const lineageHref = (lineageSlug || lineageTxid) ? `/linaje/${lineageSlug || lineageTxid}` : '';

  const imageUrl = extractImageLikeField([
    item.editorialMeta,
    item.tokenMeta?.genesisInfo,
    item.tokenMeta,
  ]);
  const showImage = Boolean(imageUrl) && !imageFailed;
  const placeholderText = buildCollectibleInitials(item.symbol || item.name, item.tokenId);
  const actionLinkStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '5px 9px',
    fontSize: '0.75rem',
    lineHeight: 1.2,
    textDecoration: 'none',
    border: '1px solid #00eaff',
    background: '#09181d',
    color: '#8ff7ff',
    letterSpacing: '0.03em',
  };

  return (
    <div
      style={{
        border: '1px solid #1a4e57',
        background: '#081216',
        padding: '10px',
        display: 'grid',
        gap: '8px',
      }}
    >
      <div
        style={{
          border: '1px solid #00eaff',
          background: 'linear-gradient(160deg, #071117 0%, #0d1d25 100%)',
          minHeight: '110px',
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
        }}
      >
        {showImage ? (
          <img
            src={imageUrl}
            alt={primaryTitle}
            loading="lazy"
            style={{ width: '100%', height: '110px', objectFit: 'cover', display: 'block' }}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div style={{ color: '#9feeff', fontWeight: 'bold', letterSpacing: '0.06em' }}>{placeholderText}</div>
        )}
      </div>

      <div style={{ color: '#d5fcff', fontWeight: 'bold', wordBreak: 'break-word' }}>{primaryTitle}</div>
      {secondaryTitle && <div style={{ color: '#8ff7ff', fontSize: '0.82rem', wordBreak: 'break-word' }}>{secondaryTitle}</div>}
      <div style={{ color: '#9adbe2', fontSize: '0.85rem' }}>{quantityLabel}</div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <Link to={`/token/${item.tokenId}`} style={actionLinkStyle}>
          Ver Token
        </Link>
        {lineageHref && (
          <Link to={lineageHref} style={actionLinkStyle}>
            Ver Linaje
          </Link>
        )}
      </div>
    </div>
  );
}

function XoloNftCollectionCard({ item }) {
  const [imageFailed, setImageFailed] = React.useState(false);
  const curatedHref = item.slug ? `/collection/xolosnft/${item.slug}` : '';
  const actionLinkStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '5px 9px',
    fontSize: '0.75rem',
    lineHeight: 1.2,
    textDecoration: 'none',
    border: '1px solid #00eaff',
    background: '#09181d',
    color: '#8ff7ff',
    letterSpacing: '0.03em',
  };
  const showImage = Boolean(item.imageUrl) && !imageFailed;
  const placeholderText = buildCollectibleInitials(item.title, item.tokenId || item.slug);
  const primaryContent = (
    <>
      <div
        style={{
          border: '1px solid #00eaff',
          background: 'linear-gradient(160deg, #071117 0%, #0d1d25 100%)',
          minHeight: '120px',
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
        }}
      >
        {showImage ? (
          <img
            src={item.imageUrl}
            alt={item.imageAlt || item.title}
            loading="lazy"
            style={{ width: '100%', height: '120px', objectFit: 'cover', display: 'block' }}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div style={{ color: '#9feeff', fontWeight: 'bold', letterSpacing: '0.06em' }}>{placeholderText}</div>
        )}
      </div>

      <div style={{ color: '#d5fcff', fontWeight: 'bold', wordBreak: 'break-word' }}>{item.title}</div>
      {item.subtitle && (
        <div style={{ color: '#99edf5', fontSize: '0.86rem', fontStyle: 'italic', lineHeight: 1.45 }}>{item.subtitle}</div>
      )}
      {item.tokenSymbol && (
        <div style={{ color: '#8ff7ff', fontSize: '0.82rem', wordBreak: 'break-word' }}>
          {item.tokenSymbol}
        </div>
      )}
      {item.narrative && (
        <div style={{ color: '#9adbe2', fontSize: '0.85rem', lineHeight: 1.4 }}>{item.narrative}</div>
      )}
      {item.slug && <div style={{ color: '#78cad2', fontSize: '0.8rem' }}>Slug: {item.slug}</div>}
      <div style={{ color: '#7dffe4', fontSize: '0.82rem', letterSpacing: '0.04em' }}>Abrir ficha curada →</div>
    </>
  );

  return (
    <article
      style={{
        border: '1px solid #1a4e57',
        background: '#081216',
        padding: '10px',
        display: 'grid',
        gap: '8px',
      }}
    >
      {curatedHref ? (
        <Link to={curatedHref} style={{ display: 'grid', gap: '8px', textDecoration: 'none' }}>
          {primaryContent}
        </Link>
      ) : primaryContent}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {item.tokenId && (
          <Link to={`/token/${item.tokenId}`} style={actionLinkStyle}>
            Token tecnico
          </Link>
        )}
        {item.lineageRef && (
          <Link to={`/linaje/${item.lineageRef}`} style={actionLinkStyle}>
            Ver Linaje
          </Link>
        )}
      </div>
    </article>
  );
}

function XoloNftCollectionPage() {
  const [query, setQuery] = React.useState('');

  const collectionItems = React.useMemo(() => buildXoloNftCollectionItems(), []);

  const filteredItems = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return collectionItems;
    return collectionItems.filter((item) => item.searchText.includes(normalizedQuery));
  }, [collectionItems, query]);

  return (
    <Shell>
      <SearchBar />
      <SectionTitle>XOLOSNFT Collection</SectionTitle>
      <div style={{ color: '#8ff7ff', marginTop: '-4px', marginBottom: '10px' }}>
        Archivo curado del Linaje Vivo
      </div>
      <div style={{ marginTop: '-2px', marginBottom: '12px' }}>
        <Link to="/collection/xolosnft/codex" style={{ color: '#7dffe4', fontSize: '0.9rem' }}>
          Vista códice
        </Link>
      </div>

      <Box style={{ marginBottom: '14px' }}>
        <p style={{ marginTop: 0, color: '#9adbe2', lineHeight: 1.5 }}>
          Seleccion editorial de NFTs y fichas narrativas del archivo XOLOSNFT. Esta vista reúne metadatos locales de
          linaje para explorar piezas con contexto tecnico y genealogico.
        </p>
        <label style={{ display: 'grid', gap: '6px', color: '#8ff7ff', fontSize: '0.85rem' }}>
          Buscar en coleccion
          <input
            type="text"
            placeholder="Nombre, slug o simbolo..."
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
      </Box>

      {filteredItems.length === 0 ? (
        <Box>No hay elementos disponibles en la colección XOLOSNFT.</Box>
      ) : (
        <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
          {filteredItems.map((item) => (
            <XoloNftCollectionCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </Shell>
  );
}

function XoloNftCodexCard({ item }) {
  const [imageFailed, setImageFailed] = React.useState(false);
  const curatedHref = item.slug ? `/collection/xolosnft/${item.slug}` : '';
  const showImage = Boolean(item.imageUrl) && !imageFailed;
  const placeholderText = buildCollectibleInitials(item.title, item.tokenId || item.slug);
  const actionLinkStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '7px 11px',
    fontSize: '0.8rem',
    lineHeight: 1.2,
    textDecoration: 'none',
    border: '1px solid #2abfce',
    background: '#0a1c22',
    color: '#b4fbff',
    letterSpacing: '0.02em',
  };
  const primaryContent = (
    <>
      <div
        style={{
          minHeight: '220px',
          borderBottom: '1px solid #1b5f6a',
          background: 'radial-gradient(circle at 15% 20%, #185b66 0%, #0b1b23 46%, #061015 100%)',
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
        }}
      >
        {showImage ? (
          <img
            src={item.imageUrl}
            alt={item.imageAlt || item.title}
            loading="lazy"
            style={{ width: '100%', minHeight: '220px', maxHeight: '320px', objectFit: 'cover', display: 'block' }}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div style={{ color: '#9feeff', fontWeight: 'bold', letterSpacing: '0.12em', fontSize: '1.25rem' }}>
            {placeholderText}
          </div>
        )}
      </div>

      <div style={{ padding: '16px' }}>
        <div style={{ color: '#8ff7ff', fontSize: '0.76rem', letterSpacing: '0.11em', textTransform: 'uppercase' }}>
          Archivo del Linaje Vivo
        </div>
        <h3 style={{ margin: '8px 0 0', color: '#dcfdff', fontSize: '1.55rem', lineHeight: 1.15 }}>
          {item.title}
        </h3>
        {item.subtitle && (
          <div style={{ marginTop: '8px', color: '#b0eef4', fontSize: '0.93rem', fontStyle: 'italic', lineHeight: 1.45 }}>
            {item.subtitle}
          </div>
        )}
        {item.tokenSymbol && (
          <div style={{ marginTop: '8px', color: '#9aeaf2', fontSize: '0.9rem' }}>
            {item.tokenSymbol}
          </div>
        )}
        <div style={{ marginTop: '10px', color: '#b9f4f9', lineHeight: 1.5, minHeight: '56px' }}>
          {item.narrative || 'Pieza del archivo editorial XOLOSNFT con referencia al linaje vivo.'}
        </div>
        {item.slug && <div style={{ marginTop: '10px', color: '#7bcfd8', fontSize: '0.84rem' }}>Clave: {item.slug}</div>}
        <div style={{ marginTop: '10px', color: '#7dffe4', fontSize: '0.85rem', letterSpacing: '0.03em' }}>
          Abrir entrada de archivo →
        </div>
      </div>
    </>
  );

  return (
    <article
      style={{
        border: '1px solid #00eaff',
        background: 'linear-gradient(160deg, #050d12 0%, #0a1a22 48%, #0d2731 100%)',
        boxShadow: '0 0 0 1px #103d46 inset, 0 0 26px rgba(0, 234, 255, 0.16)',
        display: 'grid',
        overflow: 'hidden',
      }}
    >
      {curatedHref ? (
        <Link to={curatedHref} style={{ display: 'grid', textDecoration: 'none' }}>
          {primaryContent}
        </Link>
      ) : primaryContent}
      <div style={{ padding: '0 16px 16px' }}>
        <div style={{ marginTop: '2px', display: 'flex', gap: '9px', flexWrap: 'wrap' }}>
          {item.tokenId && (
            <Link to={`/token/${item.tokenId}`} style={actionLinkStyle}>
              Ver token
            </Link>
          )}
          {item.lineageRef && (
            <Link to={`/linaje/${item.lineageRef}`} style={actionLinkStyle}>
              Ver linaje
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

function XoloNftCodexPage() {
  const [query, setQuery] = React.useState('');
  const collectionItems = React.useMemo(() => buildXoloNftCollectionItems(), []);
  const filteredItems = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return collectionItems;
    return collectionItems.filter((item) => item.searchText.includes(normalizedQuery));
  }, [collectionItems, query]);

  return (
    <Shell>
      <SearchBar />
      <SectionTitle>XOLOSNFT Codex</SectionTitle>
      <div style={{ color: '#8ff7ff', marginTop: '-4px', marginBottom: '10px' }}>
        Museo digital del Archivo del Linaje Vivo
      </div>
      <div style={{ marginTop: '-2px', marginBottom: '12px' }}>
        <Link to="/collection/xolosnft" style={{ color: '#7dffe4', fontSize: '0.9rem' }}>
          Vista explorador
        </Link>
      </div>

      <Box style={{ marginBottom: '14px', background: 'linear-gradient(160deg, #08151b 0%, #0b1f29 100%)' }}>
        <p style={{ marginTop: 0, color: '#b9f4f9', lineHeight: 1.55 }}>
          Este códice reúne piezas de XOLOSNFT como una sala curatorial: cada obra dialoga con el linaje, su memoria
          editorial y su rastro on-chain dentro del archivo vivo.
        </p>
        <label style={{ display: 'grid', gap: '6px', color: '#8ff7ff', fontSize: '0.85rem' }}>
          Buscar en códice
          <input
            type="text"
            placeholder="Nombre, slug o símbolo..."
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
      </Box>

      {filteredItems.length === 0 ? (
        <Box>No hay elementos disponibles en el códice XOLOSNFT.</Box>
      ) : (
        <div style={{ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          {filteredItems.map((item) => (
            <XoloNftCodexCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </Shell>
  );
}

function XoloNftCollectionItemPage() {
  const { slug } = useParams();
  const collectionItems = React.useMemo(() => buildXoloNftCollectionItems(), []);
  const normalizedSlug = slugify((slug || '').trim());
  const item = React.useMemo(
    () => collectionItems.find((entry) => entry.slug === normalizedSlug),
    [collectionItems, normalizedSlug],
  );
  const actionLinkStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '7px 11px',
    fontSize: '0.82rem',
    lineHeight: 1.2,
    textDecoration: 'none',
    border: '1px solid #2abfce',
    background: '#0a1c22',
    color: '#b4fbff',
    letterSpacing: '0.02em',
  };
  const metaLabelStyle = {
    color: '#79ced6',
    fontSize: '0.8rem',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  };
  const metaValueStyle = {
    color: '#d7fbff',
    wordBreak: 'break-word',
  };

  if (!item) {
    return (
      <Shell>
        <SearchBar />
        <SectionTitle>XOLOSNFT Entry</SectionTitle>
        <Box>No se encontró esta pieza dentro de la colección XOLOSNFT.</Box>
      </Shell>
    );
  }

  const tokenLabel = [item.tokenSymbol, item.tokenName].filter(Boolean).join(' / ') || '—';
  const lineageHref = item.lineageRef ? `/linaje/${item.lineageRef}` : '';
  const themeStyles = buildXoloArchiveThemeStyles(item.theme, item.accent);
  const resolvedActionLinkStyle = {
    ...actionLinkStyle,
    border: `1px solid ${themeStyles.linkBorder}`,
    background: themeStyles.linkBg,
    color: themeStyles.linkColor,
  };
  const resolvedMetaLabelStyle = { ...metaLabelStyle, color: themeStyles.label };
  const resolvedMetaValueStyle = { ...metaValueStyle, color: themeStyles.value };

  return (
    <Shell>
      <SearchBar />
      <SectionTitle>{item.title}</SectionTitle>
      {item.subtitle && (
        <div style={{ marginTop: '-4px', marginBottom: '10px', color: '#99edf5', fontStyle: 'italic', lineHeight: 1.45 }}>
          {item.subtitle}
        </div>
      )}
      <div style={{ marginBottom: '14px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <Link to="/collection/xolosnft" style={{ color: themeStyles.breadcrumb, fontSize: '0.9rem' }}>
          Volver a la colección
        </Link>
        <Link to="/collection/xolosnft/codex" style={{ color: themeStyles.breadcrumb, fontSize: '0.9rem' }}>
          Vista códice
        </Link>
      </div>

      <article
        style={{
          border: `1px solid ${themeStyles.border}`,
          background: themeStyles.articleBg,
          boxShadow: themeStyles.articleShadow,
          display: 'grid',
          gap: '14px',
          padding: '14px',
        }}
      >
        <div
          style={{
            border: `1px solid ${themeStyles.frameBorder}`,
            minHeight: '320px',
            background: themeStyles.frameBg,
            display: 'grid',
            placeItems: 'center',
            overflow: 'hidden',
          }}
        >
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.imageAlt || item.title}
              style={{ width: '100%', minHeight: '320px', maxHeight: '520px', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <div style={{ color: themeStyles.placeholder, fontWeight: 'bold', letterSpacing: '0.12em', fontSize: '1.5rem' }}>
              {buildCollectibleInitials(item.title, item.tokenId || item.slug)}
            </div>
          )}
        </div>

        <Box style={{ background: themeStyles.panelBg }}>
          <div style={{ color: themeStyles.panelTitle, fontSize: '0.78rem', letterSpacing: '0.11em', textTransform: 'uppercase' }}>
            Entrada curada
          </div>
          <div style={{ marginTop: '10px', color: themeStyles.narrative, lineHeight: 1.65 }}>
            {item.narrative || 'Registro editorial del archivo XOLOSNFT, vinculado al linaje vivo y a su rastro on-chain.'}
          </div>
          {item.backgroundNote && (
            <div style={{ marginTop: '10px', color: themeStyles.value, lineHeight: 1.55, fontSize: '0.92rem' }}>
              {item.backgroundNote}
            </div>
          )}
        </Box>

        <Box style={{ background: themeStyles.panelBg }}>
          <div style={{ display: 'grid', gap: '10px' }}>
            <div>
              <div style={resolvedMetaLabelStyle}>Slug</div>
              <div style={resolvedMetaValueStyle}>{item.slug || '—'}</div>
            </div>
            <div>
              <div style={resolvedMetaLabelStyle}>Token símbolo / nombre</div>
              <div style={resolvedMetaValueStyle}>{tokenLabel}</div>
            </div>
            <div>
              <div style={resolvedMetaLabelStyle}>Token ID</div>
              <div style={resolvedMetaValueStyle}>{item.tokenId || '—'}</div>
            </div>
            <div>
              <div style={resolvedMetaLabelStyle}>Destino de linaje</div>
              <div style={resolvedMetaValueStyle}>{item.lineageRef || '—'}</div>
            </div>
            <div>
              <div style={resolvedMetaLabelStyle}>Tema editorial</div>
              <div style={resolvedMetaValueStyle}>{item.theme || 'codex'}</div>
            </div>
          </div>
        </Box>

        <div style={{ display: 'flex', gap: '9px', flexWrap: 'wrap' }}>
          {item.tokenId && (
            <Link to={`/token/${item.tokenId}`} style={resolvedActionLinkStyle}>
              Ver token
            </Link>
          )}
          {lineageHref && (
            <Link to={lineageHref} style={resolvedActionLinkStyle}>
              Ver linaje
            </Link>
          )}
          <Link to="/collection/xolosnft" style={resolvedActionLinkStyle}>
            Volver a la colección
          </Link>
          <Link to="/collection/xolosnft/codex" style={resolvedActionLinkStyle}>
            Vista códice
          </Link>
        </div>
      </article>
    </Shell>
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

function TokenBalancesCard({ balances = [] }) {
  const fungible = balances.filter((item) => item.kind === 'fungible');
  const nfts = balances.filter((item) => item.kind === 'nft');

  return (
    <div style={{ marginTop: '24px', display: 'grid', gap: '14px' }}>
      <Box style={{ overflowX: 'auto' }}>
        <div style={{ fontWeight: 'bold', marginBottom: '10px' }}>Fungible Tokens</div>
        {!fungible.length ? (
          <div style={{ color: '#8ff7ff' }}>No hay fungibles detectados en UTXOs activos.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Token</th>
                <th style={thStyle}>Balance</th>
                <th style={thStyle}>Token ID</th>
              </tr>
            </thead>
            <tbody>
              {fungible.map((item) => (
                <tr key={item.tokenId}>
                  <td style={tdStyle}>
                    <div style={{ color: '#d5fcff' }}>{item.symbol || item.name || '—'}</div>
                    {item.name && <div style={{ color: '#8ff7ff', fontSize: '0.82rem' }}>{item.name}</div>}
                  </td>
                  <td style={tdStyle}>
                    <div>{item.humanBalance}</div>
                    <div style={{ color: '#77aeb6', fontSize: '0.8rem', marginTop: '4px' }}>raw: {item.rawBalance}</div>
                  </td>
                  <td style={tdStyle}>
                    <TokenLink tokenId={item.tokenId}>{shortHex(item.tokenId, 18, 14)}</TokenLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Box>

      <Box>
        <div style={{ fontWeight: 'bold', marginBottom: '10px' }}>NFTs / Collectibles</div>
        {!nfts.length ? (
          <div style={{ color: '#8ff7ff' }}>No hay NFTs o coleccionables detectados.</div>
        ) : (
          <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
            {nfts.map((item) => (
              <NftCollectibleCard key={item.tokenId} item={item} />
            ))}
          </div>
        )}
      </Box>
      {!balances.length && (
        <Box>
          <div style={{ color: '#8ff7ff' }}>No hay tokens detectados.</div>
        </Box>
      )}
    </div>
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
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '8px' }}>XOLOS EXPLORER</h1>
        <p style={{ color: '#8ff7ff', marginBottom: '16px' }}>
          Explorador mínimo avanzado conectado a tu Chronik soberano
        </p>
        <Box style={{ marginBottom: '16px' }}>
          <div><strong>Endpoint:</strong> {CHRONIK_URL}</div>
        </Box>
      </div>
      <SearchBar />
      <StatGrid
        items={[
          { label: 'Ruta Explorer', value: <Link to="/explorer" style={{ color: '#00eaff' }}>/explorer</Link> },
          { label: 'Ruta Linaje', value: <Link to="/linaje" style={{ color: '#00eaff' }}>/linaje</Link> },
          { label: 'Bloque ejemplo', value: <Link to="/block/9000" style={{ color: '#00eaff' }}>/block/9000</Link> },
        ]}
      />
      <div
        style={{
          marginTop: '18px',
          padding: '10px 12px',
          border: '1px solid #1f464d',
          background: '#081216',
          color: '#78cad2',
          fontSize: '0.88rem',
        }}
      >
        Explora el ecosistema cultural y blockchain de XolosArmy:{' '}
        <a
          href="https://xolosarmy.xyz"
          target="_blank"
          rel="noreferrer"
          style={{ color: '#8de6ef', textDecoration: 'none' }}
        >
          más sobre el proyecto →
        </a>
      </div>
    </Shell>
  );
}

function StatusPage() {
  const [state, setState] = React.useState({ loading: true, error: '', info: null });

  React.useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setState({ loading: true, error: '', info: null });
        const info = await chronik.blockchainInfo();
        if (mounted) setState({ loading: false, error: '', info });
      } catch (err) {
        if (mounted) setState({ loading: false, error: err?.message || 'No se pudo cargar el estado del nodo.', info: null });
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  const info = state.info || {};

  return (
    <Shell>
      <SearchBar />
      <SectionTitle>Estado del Nodo</SectionTitle>
      {state.loading && <LoadingBox text="Consultando Chronik..." />}
      {state.error && <ErrorBox error={state.error} />}
      {state.info && (
        <>
          <StatGrid
            items={[
              { label: 'Altura actual', value: formatNumber(info.tipHeight) },
              { label: 'Tip hash', value: info.tipHash || '—' },
              { label: 'Estado', value: 'Online' },
            ]}
          />
          <Box style={{ marginTop: '14px' }}>
            <div style={{ color: '#8ff7ff', marginBottom: '6px' }}>Network Status</div>
            <div><strong>Endpoint:</strong> {CHRONIK_URL}</div>
            <div style={{ marginTop: '6px' }}>
              Nodo sincronizado hasta altura <strong>{formatNumber(info.tipHeight)}</strong> con tip{' '}
              <span style={{ color: '#bffbff' }}>{shortHex(info.tipHash, 20, 16)}</span>.
            </div>
          </Box>
        </>
      )}
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
        const txs = history?.txs || [];
        const utxoList = utxos?.utxos || [];
        const tokenIds = Array.from(new Set(
          utxoList
            .map((utxo) => utxo?.token?.tokenId?.toLowerCase())
            .filter(Boolean),
        ));

        const tokenInfoById = {};
        await Promise.all(
          tokenIds.map(async (tokenId) => {
            try {
              const token = await chronik.token(tokenId);
              tokenInfoById[tokenId] = token;
            } catch {
              tokenInfoById[tokenId] = null;
            }
          })
        );

        if (mounted) setState({ loading: false, error: '', data: { history, utxos, tokenInfoById } });
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
  const tokenInfoById = state.data?.tokenInfoById || {};
  const tokenBalances = React.useMemo(() => {
    const balances = new Map();
    for (const utxo of utxos) {
      const token = utxo?.token;
      if (!token) continue;

      const tokenId = token.tokenId?.toLowerCase();
      if (!tokenId) continue;

      const amount = token.amount ?? token.atoms ?? 0;
      const prev = balances.get(tokenId) || 0n;
      balances.set(tokenId, prev + toBigIntSafe(amount));
    }

    return Array.from(balances.entries())
      .map(([tokenId, amount]) => {
        const tokenMeta = tokenInfoById[tokenId];
        const editorialMeta = resolveLinajeMeta({ txid: tokenId });
        const isRmz = tokenId.toLowerCase() === RMZ_TOKEN_ID;
        const symbol = isRmz ? 'RMZ' : (tokenMeta?.tokenTicker || tokenMeta?.genesisInfo?.tokenTicker || '');
        const name = tokenMeta?.tokenName || tokenMeta?.genesisInfo?.tokenName || '';
        const decimals = Number(tokenMeta?.decimals ?? tokenMeta?.genesisInfo?.decimals ?? 0);

        // NFT heuristic: explicit metadata hints win; otherwise, default 0-decimals + single-unit balances to collectibles.
        const typeHints = [
          tokenMeta?.tokenType,
          tokenMeta?.genesisInfo?.tokenType,
          tokenMeta?.tokenTicker,
          tokenMeta?.tokenName,
          tokenMeta?.genesisInfo?.tokenTicker,
          tokenMeta?.genesisInfo?.tokenName,
        ]
          .filter(Boolean)
          .map((v) => String(v).toLowerCase())
          .join(' ');
        const hasNftHint = /nft|collectible|collection|artifact|child/.test(typeHints);
        const isLikelyNft = !isRmz && (hasNftHint || (decimals === 0 && toBigIntSafe(amount) === 1n));

        return {
          tokenId,
          amount,
          symbol,
          name,
          decimals,
          tokenMeta,
          editorialMeta,
          humanBalance: formatTokenAmountWithDecimals(amount, decimals),
          rawBalance: formatTokenAmount(amount),
          kind: isLikelyNft ? 'nft' : 'fungible',
        };
      })
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'fungible' ? -1 : 1;
        if (a.amount === b.amount) return a.tokenId.localeCompare(b.tokenId);
        return a.amount > b.amount ? -1 : 1;
      });
  }, [utxos, tokenInfoById]);

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

          <TokenBalancesCard balances={tokenBalances} />

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
        <Route path="/collection/xolosnft" element={<XoloNftCollectionPage />} />
        <Route path="/coleccion/xolosnft" element={<XoloNftCollectionPage />} />
        <Route path="/collection/xolosnft/codex" element={<XoloNftCodexPage />} />
        <Route path="/coleccion/xolosnft/codice" element={<XoloNftCodexPage />} />
        <Route path="/collection/xolosnft/:slug" element={<XoloNftCollectionItemPage />} />
        <Route path="/coleccion/xolosnft/:slug" element={<XoloNftCollectionItemPage />} />
        <Route path="/status" element={<StatusPage />} />
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
