import React, { useMemo, useState } from 'react';
import { BrowserRouter, Link, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { ChronikClient } from 'chronik-client';

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
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        <div style={{ marginBottom: '20px' }}>
          <Link to="/" style={{ color: '#00eaff', textDecoration: 'none' }}>
            <h1 style={{ fontSize: '3rem', marginBottom: '10px' }}>XOLOS EXPLORER</h1>
          </Link>
          <p style={{ color: '#8ff7ff', marginBottom: '20px' }}>
            Explorador mínimo conectado a tu Chronik soberano
          </p>
          <div
            style={{
              border: '1px solid #00eaff',
              padding: '14px',
              marginBottom: '20px',
              background: '#0b0b0b',
            }}
          >
            <div><strong>Endpoint:</strong> {CHRONIK_URL}</div>
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

function HomePage() {
  return (
    <Shell>
      <SearchBar />
      <div style={{ marginTop: '28px', color: '#b8fdff' }}>
        <p>Rutas habilitadas:</p>
        <ul>
          <li><code>/block/:height</code></li>
          <li><code>/tx/:txid</code></li>
          <li><code>/address/:address</code></li>
          <li><code>/token/:tokenId</code></li>
          <li><code>/search/:hash</code></li>
        </ul>
      </div>
    </Shell>
  );
}

function LoadingBox({ text = 'Olfateando la blockchain...' }) {
  return (
    <div style={{ marginTop: '20px', border: '1px solid #00eaff', padding: '14px', background: '#0b0b0b' }}>
      {text}
    </div>
  );
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

function ResultBox({ title, data }) {
  return (
    <div style={{ marginTop: '24px' }}>
      <h2 style={{ marginBottom: '10px' }}>{title}</h2>
      <pre
        style={{
          background: '#0b0b0b',
          border: '1px solid #00eaff',
          padding: '16px',
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: '#d7fdff',
        }}
      >
        {safeStringify(data)}
      </pre>
    </div>
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
          chronik.blockTxs(height, 0, 10),
        ]);
        if (mounted) setState({ loading: false, error: '', data: { kind: 'block', block, txs } });
      } catch (err) {
        if (mounted) setState({ loading: false, error: err?.message || 'No se pudo cargar el bloque.', data: null });
      }
    }
    load();
    return () => { mounted = false; };
  }, [height]);

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
          <div style={{ marginTop: '24px', display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div style={{ border: '1px solid #00eaff', padding: '14px', background: '#0b0b0b' }}>
              <div>Altura</div>
              <strong>{state.data.block.blockInfo?.height}</strong>
            </div>
            <div style={{ border: '1px solid #00eaff', padding: '14px', background: '#0b0b0b' }}>
              <div>Hash</div>
              <strong>{shortHex(state.data.block.blockInfo?.hash)}</strong>
            </div>
            <div style={{ border: '1px solid #00eaff', padding: '14px', background: '#0b0b0b' }}>
              <div>Fecha</div>
              <strong>{unixToText(state.data.block.blockInfo?.timestamp)}</strong>
            </div>
            <div style={{ border: '1px solid #00eaff', padding: '14px', background: '#0b0b0b' }}>
              <div>TXs</div>
              <strong>{state.data.block.blockInfo?.numTxs}</strong>
            </div>
          </div>
          <ResultBox title="Resultado: BLOCK" data={state.data} />
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
        if (mounted) setState({ loading: false, error: '', data: { kind: 'tx', tx } });
      } catch (err) {
        if (mounted) setState({ loading: false, error: err?.message || 'No se pudo cargar la transacción.', data: null });
      }
    }
    load();
    return () => { mounted = false; };
  }, [txid]);

  return (
    <Shell>
      <SearchBar />
      <div style={{ marginTop: '20px', color: '#8ff7ff' }}>
        Viendo transacción: <strong>{shortHex(txid, 20, 16)}</strong>
      </div>
      {state.loading && <LoadingBox />}
      {state.error && <ErrorBox error={state.error} />}
      {state.data && <ResultBox title="Resultado: TX" data={state.data} />}
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
          chronik.address(decodedAddress).history(0, 10),
          chronik.address(decodedAddress).utxos(),
        ]);
        if (mounted) setState({ loading: false, error: '', data: { kind: 'address', address: decodedAddress, history, utxos } });
      } catch (err) {
        if (mounted) setState({ loading: false, error: err?.message || 'No se pudo cargar la dirección.', data: null });
      }
    }
    load();
    return () => { mounted = false; };
  }, [decodedAddress]);

  return (
    <Shell>
      <SearchBar />
      <div style={{ marginTop: '20px', color: '#8ff7ff', wordBreak: 'break-word' }}>
        Viendo dirección: <strong>{decodedAddress}</strong>
      </div>
      {state.loading && <LoadingBox />}
      {state.error && <ErrorBox error={state.error} />}
      {state.data && <ResultBox title="Resultado: ADDRESS" data={state.data} />}
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
        if (mounted) setState({ loading: false, error: '', data: { kind: 'token', token } });
      } catch (err) {
        if (mounted) setState({ loading: false, error: err?.message || 'No se pudo cargar el token.', data: null });
      }
    }
    load();
    return () => { mounted = false; };
  }, [tokenId]);

  return (
    <Shell>
      <SearchBar />
      <div style={{ marginTop: '20px', color: '#8ff7ff', wordBreak: 'break-word' }}>
        Viendo token: <strong>{shortHex(tokenId, 20, 16)}</strong>
      </div>
      {state.loading && <LoadingBox />}
      {state.error && <ErrorBox error={state.error} />}
      {state.data && <ResultBox title="Resultado: TOKEN" data={state.data} />}
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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/block/:height" element={<BlockPage />} />
        <Route path="/tx/:txid" element={<TxPage />} />
        <Route path="/address/:address" element={<AddressPage />} />
        <Route path="/token/:tokenId" element={<TokenPage />} />
        <Route path="/search/:hash" element={<SearchHashPage />} />
      </Routes>
    </BrowserRouter>
  );
}