import React, { useMemo, useState } from 'react';
import { BrowserRouter, Link, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { ChronikClient } from 'chronik-client';
import * as ecashaddr from 'ecashaddrjs';

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

    // P2PKH: 76a914{20-byte-hash}88ac
    if (outputScript.startsWith('76a914') && outputScript.endsWith('88ac') && outputScript.length === 50) {
      const hash = outputScript.slice(6, -4);
      return ecashaddr.encodeCashAddress('ecash', 'p2pkh', hash);
    }

    // P2SH: a914{20-byte-hash}87
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

function decodeOpReturnHex(hex) {
  if (!hex || !hex.startsWith('6a')) return null;
  try {
    // decodificación simple para el MVP
    const body = hex.slice(2);
    return body;
  } catch {
    return null;
  }
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

function TokenLink({ tokenId }) {
  return (
    <Link to={`/token/${tokenId}`} style={{ color: '#00eaff' }}>
      {shortHex(tokenId, 18, 14)}
    </Link>
  );
}

function TxList({ txs = [] }) {
  if (!txs.length) return <Box>No hay transacciones.</Box>;

  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      {txs.map((tx) => (
        <Box key={tx.txid}>
          <div style={{ marginBottom: '8px' }}>
            <strong>TXID:</strong> <TxLink txid={tx.txid} />
          </div>
          <div style={{ color: '#b8fdff' }}>
            Inputs: {formatNumber(tx.inputs?.length || 0)} · Outputs: {formatNumber(tx.outputs?.length || 0)}
          </div>
          <div style={{ color: '#b8fdff', marginTop: '6px' }}>
            {tx.block?.height !== undefined ? (
              <>Bloque: <BlockLink hashOrHeight={tx.block.height}>{tx.block.height}</BlockLink></>
            ) : (
              'Mempool'
            )}
          </div>
        </Box>
      ))}
    </div>
  );
}

function OutputsTable({ outputs = [] }) {
  if (!outputs.length) return <Box>No hay salidas.</Box>;

  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      {outputs.map((output, idx) => {
        const addr = outputScriptToAddress(output.outputScript);
        const opReturn = isOpReturn(output.outputScript);
        const tokenEntries = output.token ? [output.token] : [];

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
                  {decodeOpReturnHex(output.outputScript)}
                </div>
              </div>
            )}

            {!addr && !opReturn && (
              <div style={{ marginTop: '8px', color: '#8ff7ff', wordBreak: 'break-word' }}>
                Script: {output.outputScript || '—'}
              </div>
            )}

            {tokenEntries.length > 0 && (
              <div style={{ marginTop: '10px' }}>
                <div>Token:</div>
                <pre
                  style={{
                    background: '#111',
                    color: '#d7fdff',
                    padding: '10px',
                    overflowX: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {safeStringify(tokenEntries)}
                </pre>
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

          {input.outputScript && (
            <div style={{ marginTop: '8px', wordBreak: 'break-word', color: '#8ff7ff' }}>
              Output script origen: {input.outputScript}
            </div>
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
    return () => {
      mounted = false;
    };
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
            ]}
          />

          <SectionTitle>Transacciones del bloque</SectionTitle>
          <TxList txs={state.data?.txs?.txs || []} />

          <SectionTitle>JSON crudo</SectionTitle>
          <Box style={{ overflowX: 'auto' }}>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#d7fdff' }}>
              {safeStringify(state.data)}
            </pre>
          </Box>
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
    return () => {
      mounted = false;
    };
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

          {tx.tokenEntries && Object.keys(tx.tokenEntries).length > 0 && (
            <>
              <SectionTitle>Token entries</SectionTitle>
              <Box style={{ overflowX: 'auto' }}>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#d7fdff' }}>
                  {safeStringify(tx.tokenEntries)}
                </pre>
              </Box>
            </>
          )}

          <SectionTitle>JSON crudo</SectionTitle>
          <Box style={{ overflowX: 'auto' }}>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#d7fdff' }}>
              {safeStringify(tx)}
            </pre>
          </Box>
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
    return () => {
      mounted = false;
    };
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

          <SectionTitle>UTXOs</SectionTitle>
          {utxos.length ? (
            <div style={{ display: 'grid', gap: '12px' }}>
              {utxos.map((utxo, idx) => (
                <Box key={`${utxo.outpoint?.txid}-${utxo.outpoint?.outIdx}-${idx}`}>
                  <div>
                    TX: <TxLink txid={utxo.outpoint?.txid} />
                  </div>
                  <div style={{ marginTop: '6px' }}>OutIdx: {utxo.outpoint?.outIdx}</div>
                  <div style={{ marginTop: '6px' }}>Valor: {satsToXec(utxo.sats)}</div>
                  {utxo.token && (
                    <div style={{ marginTop: '10px' }}>
                      <pre
                        style={{
                          background: '#111',
                          color: '#d7fdff',
                          padding: '10px',
                          overflowX: 'auto',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {safeStringify(utxo.token)}
                      </pre>
                    </div>
                  )}
                </Box>
              ))}
            </div>
          ) : (
            <Box>No hay UTXOs.</Box>
          )}

          <SectionTitle>Historial reciente</SectionTitle>
          <TxList txs={txs} />

          <SectionTitle>JSON crudo</SectionTitle>
          <Box style={{ overflowX: 'auto' }}>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#d7fdff' }}>
              {safeStringify(state.data)}
            </pre>
          </Box>
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
    return () => {
      mounted = false;
    };
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
        <>
          <StatGrid
            items={[
              { label: 'Token ID', value: token.tokenId || tokenId },
              { label: 'Ticker', value: token.tokenTicker || '—' },
              { label: 'Nombre', value: token.tokenName || '—' },
              { label: 'Decimales', value: token.decimals ?? '—' },
              { label: 'URL', value: token.url || '—' },
            ]}
          />

          <SectionTitle>JSON crudo</SectionTitle>
          <Box style={{ overflowX: 'auto' }}>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#d7fdff' }}>
              {safeStringify(token)}
            </pre>
          </Box>
        </>
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
    return () => {
      mounted = false;
    };
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