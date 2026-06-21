import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { fmt, fdate, soloTelefono } from '../lib/format';
import { Emoji, useTextoEmoji } from '../context/EmojiContext';

export default function Puntos() {
  const txt = useTextoEmoji();
  const [codigo, setCodigo] = useState('');
  const [msg, setMsg] = useState(null);
  const [ticket, setTicket] = useState(null);
  const canvasRef = useRef(null);

  const { data: usados, error, refetch } = useQuery({
    queryKey: ['puntos-usados'],
    queryFn: () => api.get('/api/puntos/usados'),
  });

  useEffect(() => {
    if (!ticket || !canvasRef.current) return;
    const waNum = (ticket.telefono_bot || '').replace(/[^0-9]/g, '') || '524441234567';
    const waUrl = `https://wa.me/${waNum}?text=${encodeURIComponent(ticket.codigo_qr)}`;
    QRCode.toCanvas(canvasRef.current, waUrl, { width: 200, color: { dark: '#1a1a2e', light: '#ffffff' } });
  }, [ticket]);

  const generar = async (codigoForzado) => {
    const c = (codigoForzado ?? codigo).trim().toUpperCase();
    if (!/^TK-[A-Z0-9]{8}$/.test(c)) { setMsg({ ok: false, texto: 'Formato inválido. Debe ser TK-XXXXXXXX' }); return; }
    try {
      const r = await api.get(`/api/puntos/ticket/${encodeURIComponent(c)}`);
      if (!r || !r.codigo_qr) { setMsg({ ok: false, texto: 'Código no encontrado' }); setTicket(null); return; }
      setCodigo(c);
      setMsg(null);
      setTicket(r);
    } catch (e) { setMsg({ ok: false, texto: e.message }); }
  };

  const ticketAleatorio = async () => {
    try {
      const r = await api.get('/api/puntos/ticket/RANDOM');
      if (r && r.codigo_qr) generar(r.codigo_qr);
      else setMsg({ ok: false, texto: 'Sin tickets disponibles' });
    } catch (e) { setMsg({ ok: false, texto: e.message }); }
  };

  return (
    <div>
      <div className="page-title">Puntos QR</div>
      <div className="page-sub">Generador de QR de tickets para reclamar puntos de lealtad</div>
      {error && <div className="login-error">No se pudieron cargar los tickets reclamados: {error.message}</div>}

      <div className="kpi-grid" style={{ gridTemplateColumns: '1fr 1.4fr', alignItems: 'start' }}>
        <div className="card">
          <div className="card-header"><h3>{txt('🔍 Generador de QR')}</h3></div>
          <div className="login-field">
            <label>Código del ticket</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input placeholder="TK-XXXXXXXX" style={{ fontFamily: 'monospace', flex: 1 }} value={codigo} onChange={e => setCodigo(e.target.value)} />
              <button className="btn btn-secondary btn-sm" onClick={ticketAleatorio} title="Ticket aleatorio">🎲</button>
            </div>
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => generar()}>Generar QR</button>
          {msg && <div className={msg.ok ? 'card' : 'login-error'} style={{ marginTop: 14 }}>{txt(msg.texto)}</div>}
          <div style={{ marginTop: 14, minHeight: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            {!ticket && <span className="text-muted" style={{ fontSize: 13 }}>El QR aparecerá aquí</span>}
            {ticket && (
              <>
                <canvas ref={canvasRef} />
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-mute)', textAlign: 'center' }}>
                  <code>{ticket.codigo_qr}</code><br />
                  <Emoji>💰 </Emoji>${fmt(ticket.total)} · <Emoji>⭐ </Emoji>{ticket.puntos_otorgados || 0} pts<br />
                  {ticket.puntos_reclamados
                    ? <span style={{ color: 'var(--red)' }}>{txt('⛔ Ya reclamado')}</span>
                    : <span style={{ color: 'var(--green)' }}>{txt('✅ Disponible')}</span>}
                  {' '}· Vence: {fdate(ticket.expira_reclamo_en)}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>{txt('📋 Tickets reclamados')}</h3>
            <div className="actions"><button className="btn btn-secondary btn-sm" onClick={() => refetch()}>🔄</button></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Código</th><th>Total</th><th>Puntos</th><th>Teléfono</th><th>Reclamado</th></tr></thead>
              <tbody>
                {usados === undefined && <tr><td colSpan={5} className="empty">Cargando...</td></tr>}
                {usados?.length === 0 && <tr><td colSpan={5} className="empty">Sin tickets reclamados aún</td></tr>}
                {usados?.map((r, i) => (
                  <tr key={i}>
                    <td><code>{r.codigo_qr}</code></td>
                    <td>${fmt(r.total)}</td>
                    <td><strong>{r.puntos_otorgados || 0}</strong> pts</td>
                    <td><code style={{ fontSize: 11 }}>{soloTelefono(r.telefono_cliente)}</code></td>
                    <td className="text-muted" style={{ fontSize: 11 }}>{fdate(r.reclamado_en)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
