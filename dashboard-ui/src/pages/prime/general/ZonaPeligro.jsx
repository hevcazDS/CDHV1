// ZonaPeligro.jsx — Zona de PELIGRO (solo prime): respaldo manual, purga de
// sesión de WhatsApp (HS-503) y reset total de la instancia. Todo con
// confirmaciones fuertes. Extraído de GeneralTab.jsx, sin cambios de comportamiento.
import { useState } from 'react';
import { api } from '../../../api';
import { prompt } from '../../../lib/ui';

export function ZonaPeligro() {
  const [msg, setMsg] = useState(null);
  const correr = async (nombre, fn) => {
    try { const r = await fn(); setMsg({ ok: r.ok !== false, t: nombre + ': ' + (r.ok !== false ? (r.nota || 'listo') : r.error) }); }
    catch (e) { setMsg({ ok: false, t: nombre + ': ' + e.message }); }
  };
  const pedir = async (titulo) => {
    const password = await prompt({ titulo: 'Confirmar', mensaje: titulo + '\n\nTu contraseña de Prime:', tipo: 'password' });
    if (!password) return null;
    const confirmacion = await prompt({ titulo: 'Confirmar', mensaje: 'Escribe BORRAR para confirmar:' });
    if (confirmacion !== 'BORRAR') return null;
    return { password, confirmacion };
  };
  return (
    <div className="card" style={{ marginTop: 14, borderColor: 'var(--red)' }}>
      <div className="card-header"><h3 style={{ color: 'var(--red)' }}>Zona de peligro (solo Prime)</h3></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => correr('Respaldo', () => api.post('/api/prime/respaldo-manual'))}>
          Respaldo manual ahora
        </button>
        <button className="btn" style={{ borderColor: 'var(--yellow)' }} onClick={async () => {
          const d = await pedir('BORRAR SESIÓN DE WHATSAPP (HS-503): desvincula el número; el siguiente arranque pide QR limpio. Úsalo si el bridge quedó en conflicto.');
          if (d) correr('Purga WhatsApp', () => api.post('/api/prime/whatsapp/purgar-sesion', d));
        }}>
          Borrar sesión de WhatsApp
        </button>
        <button className="btn btn-danger" onClick={async () => {
          const d = await pedir('RESET DE INSTANCIA: borra TODA la operación (pedidos, clientes, inventario) y reabre el onboarding. Solo sobreviven los usuarios Prime.');
          if (d) correr('Reset', () => api.post('/api/prime/reset-instancia', d));
        }}>
          Resetear instancia (borrar todo)
        </button>
      </div>
      {msg && <p style={{ fontSize: 12, marginTop: 10, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.t}</p>}
    </div>
  );
}
