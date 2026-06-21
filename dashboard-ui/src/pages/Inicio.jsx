import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api';

// El QR expira cada ~20-30s y bot/index.js publica uno nuevo en
// `configuracion` en cada refresh (ver bot/index.js client.on('qr')) —
// hay que pollear seguido para no mostrar uno ya vencido.
const QR_POLL_MS = 4000;

export default function Inicio() {
  const [pedidos, setPedidos] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [qr, setQr] = useState(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    api.get('/api/pedidos').then(setPedidos).catch(e => setError(e.message));
    // emails_error no tenía ningún lugar en el dashboard donde verse — antes
    // un correo de confirmación fallido solo era visible consultando SQL
    // directo (ver dashboard/server.js /api/stats).
    api.get('/api/stats').then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    let activo = true;
    const poll = () => api.get('/api/bot/qr').then(r => { if (activo) setQr(r?.qr || null); }).catch(() => {});
    poll();
    const id = setInterval(poll, QR_POLL_MS);
    return () => { activo = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!qr || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, qr, { width: 220, color: { dark: '#1a1a2e', light: '#ffffff' } });
  }, [qr]);

  const total = pedidos?.length || 0;
  const pendientes = pedidos?.filter(p => p.estatus !== 'entregado' && p.estatus !== 'cancelado').length || 0;
  const emailsError = stats?.emails_error || 0;

  return (
    <div>
      <div className="page-title">Inicio</div>
      <div className="page-sub">Resumen general de la operación</div>
      {error && <div className="login-error" style={{ marginBottom: 20 }}>No se pudieron cargar los pedidos: {error}</div>}
      {qr && (
        <div className="card" style={{ marginBottom: 20, padding: 24, textAlign: 'center', borderColor: 'var(--accent)' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>📱 WhatsApp desconectado — escanea el QR para vincular</div>
          <div style={{ opacity: 0.7, fontSize: 13, marginBottom: 16 }}>
            Se actualiza solo cada {Math.round(QR_POLL_MS / 1000)}s mientras no se escanee. Si el teléfono pierde la
            vinculación más adelante, este QR vuelve a aparecer aquí automáticamente.
          </div>
          <canvas ref={canvasRef} />
        </div>
      )}
      <div className="kpi-grid">
        <div className="card kpi-card">
          <span className="kpi-label">Pedidos (últimos 100)</span>
          <span className="kpi-value">{total}</span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Pendientes</span>
          <span className="kpi-value">{pendientes}</span>
        </div>
        {emailsError > 0 && (
          <div className="card kpi-card" style={{ borderColor: 'var(--red)' }}>
            <span className="kpi-label">⚠️ Emails con error</span>
            <span className="kpi-value">{emailsError}</span>
          </div>
        )}
      </div>
    </div>
  );
}
