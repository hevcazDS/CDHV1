import { useEffect, useState } from 'react';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';

const MODULOS = [
  { key: 'puntos_activo', titulo: '⭐ Puntos de Lealtad', desc: 'Clientes acumulan puntos con tickets QR' },
  { key: 'ofertas_activo', titulo: '🏷️ Ofertas y Descuentos', desc: 'Bot muestra ofertas activas' },
  { key: 'upselling_activo', titulo: '💡 Upselling en carrito', desc: 'Sugerencias de productos complementarios' },
  { key: 'lista_espera_activo', titulo: '🔔 Lista de espera', desc: 'Notifica cuando llega stock esperado' },
  { key: 'carritos_activo', titulo: '🛒 Carritos abandonados', desc: 'Mensaje automático 2h después' },
  { key: 'vision_activo', titulo: '📸 Búsqueda por imagen', desc: 'Vision API para búsqueda con fotos' },
  { key: 'referidos_activo', titulo: '🤝 Programa de referidos', desc: 'Código de referido y puntos en la primera compra' },
];

const TONOS = [
  { id: 'A', titulo: '👔 Formal', desc: 'Trato de usted, lenguaje corporativo. Para clientes mayores o B2B.', ejemplo: 'Bienvenido a Julio Cepeda Jugueterías. Es un gusto atenderle.' },
  { id: 'B', titulo: '😎 Casual', desc: 'Directo y breve. Mensajes cortos para respuestas rápidas.', ejemplo: '¡Hola! Soy el bot de Julio Cepeda. ¿Qué necesitas?' },
  { id: 'C', titulo: '🧸 Amigable', desc: 'Cálido y con emojis. Tono por defecto, equilibrado para todo público.', ejemplo: '¡Hola! Bienvenido a Julio Cepeda Jugueterías 🎉' },
  { id: 'D', titulo: '🎯 Ventas (23-40)', desc: 'Beneficio primero, urgencia honesta. Optimizado para conversión.', ejemplo: 'Llegaste a Julio Cepeda, 600 juguetes con entrega hoy mismo.' },
];

export default function Modulos() {
  const [estado, setEstado] = useState(null);
  const [tono, setTonoActual] = useState(null);
  const [tonoMsg, setTonoMsg] = useState(null);

  const cargarModulos = async () => {
    const rows = [];
    for (const m of MODULOS) {
      try {
        const r = await api.get(`/api/modulo/${m.key}`);
        rows.push({ key: m.key, activo: r && !r.error ? !!r.activo : true });
      } catch (_) { /* ignorar, mantiene la lista parcial */ }
    }
    setEstado(rows);
  };
  const cargarTono = () => {
    api.get('/api/tono').then(r => setTonoActual(r?.tono || 'C')).catch(() => setTonoActual('C'));
  };
  useEffect(() => { cargarModulos(); cargarTono(); }, []);

  const activoDe = (key) => estado?.find(r => r.key === key)?.activo ?? true;

  const toggle = async (clave, activo) => {
    const accion = activo ? 'activar' : 'desactivar';
    if (!window.confirm(`¿Seguro que quieres ${accion} este módulo? Afecta a los clientes de inmediato.`)) return;
    try { await api.post('/api/puntos/config', { clave, activo }); cargarModulos(); }
    catch (e) { handleApiError(e); }
  };

  const cambiarTono = async (t) => {
    try {
      const r = await api.post('/api/tono', { tono: t });
      setTonoActual(r.tono);
      setTonoMsg({ ok: true, texto: '✅ Modo actualizado. Aplica en menos de 60 segundos.' });
    } catch (e) { setTonoMsg({ ok: false, texto: '❌ ' + e.message }); }
  };

  return (
    <div>
      <div className="page-title">Módulos</div>
      <div className="page-sub">Funciones del bot y modo de conversación</div>

      <div className="kpi-grid" style={{ gridTemplateColumns: '1.3fr 1fr', alignItems: 'start' }}>
        <div className="card">
          <div className="card-header"><h3>⚙️ Módulos del sistema</h3></div>
          <p style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 14 }}>Activa o desactiva funciones sin reiniciar el bot.</p>
          {MODULOS.map(m => (
            <div className="toggle-row" key={m.key}>
              <div className="info"><h4>{m.titulo}</h4><p>{m.desc}</p></div>
              <label className="switch">
                <input type="checkbox" checked={activoDe(m.key)} onChange={e => toggle(m.key, e.target.checked)} />
                <span className="switch-slider"></span>
              </label>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-header"><h3>📋 Estado de módulos</h3></div>
          {estado === null && <div className="empty">Cargando...</div>}
          {estado?.map(r => (
            <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
              <code style={{ fontSize: 12 }}>{r.key}</code>
              <span className={`badge badge-${r.activo ? 'verde' : 'rojo'}`}>{r.activo ? '✅ Activo' : '⛔ Inactivo'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-header"><h3>🎭 Modo de conversación del bot</h3></div>
        <p style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 14 }}>Define el estilo con el que el bot le habla a los clientes. El cambio aplica en menos de 60 segundos, sin reiniciar el bot.</p>
        <div className="kpi-grid" style={{ gap: 10 }}>
          {TONOS.map(t => (
            <div key={t.id} className={`tono-opt${tono === t.id ? ' sel' : ''}`} onClick={() => cambiarTono(t.id)}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <h4>{t.titulo}</h4>
                <span className="tono-check badge badge-verde">Activo</span>
              </div>
              <p>{t.desc}</p>
              <em>"{t.ejemplo}"</em>
            </div>
          ))}
        </div>
        {tonoMsg && <div className={tonoMsg.ok ? 'card' : 'login-error'} style={{ marginTop: 12 }}>{tonoMsg.texto}</div>}
      </div>
    </div>
  );
}
