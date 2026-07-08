import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Switch, TextInput } from '@mantine/core';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';
import { useTextoEmoji, EMOJIS_ACTIVO_QUERY_KEY } from '../context/EmojiContext';

// Gestión de métodos de pago: activar/desactivar cada uno y, para
// transferencia, capturar la CLABE que el bot muestra al cliente cuando el
// módulo "Pago multi-método" está activo.
function MetodosPagoCard({ txt }) {
  const qc = useQueryClient();
  const { data: metodos } = useQuery({ queryKey: ['metodos-pago'], queryFn: () => api.get('/api/metodos-pago') });
  const [clabe, setClabe] = useState(null); // null = aún no editado

  const mut = useMutation({
    mutationFn: ({ id, body }) => api.put(`/api/metodos-pago/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['metodos-pago'] }),
    onError: (e) => handleApiError(e),
  });

  const clabeDe = (m) => {
    if (clabe !== null) return clabe;
    try { return JSON.parse(m.configuracion || '{}').clabe || ''; } catch { return ''; }
  };

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-header"><h3>{txt('💳 Métodos de pago')}</h3></div>
      <p style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 14 }}>
        Activa los que aceptas. El bot solo los ofrece al cliente si el módulo <strong>Pago multi-método</strong> está encendido.
      </p>
      {!metodos && <div className="empty">Cargando...</div>}
      {metodos?.map(m => (
        <div key={m.id} className="toggle-row">
          <div className="info">
            <h4 style={{ textTransform: 'capitalize' }}>{m.nombre}{m.requiere_link ? ' 🔗' : ''}</h4>
            {m.nombre === 'transferencia' && m.activo
              ? <TextInput size="xs" placeholder="CLABE a mostrar al cliente" style={{ marginTop: 4, maxWidth: 260 }}
                  defaultValue={clabeDe(m)}
                  onBlur={e => mut.mutate({ id: m.id, body: { configuracion: { clabe: e.target.value.replace(/\s/g, '') } } })} />
              : <p>{m.requiere_link ? 'Genera link de pago' : 'Sin pasarela (efectivo/transferencia/OXXO)'}</p>}
          </div>
          <Switch checked={!!m.activo} onChange={e => mut.mutate({ id: m.id, body: { activo: e.target.checked } })} color="blue" />
        </div>
      ))}
    </div>
  );
}

// PIN de autorización: cancelaciones, devoluciones y salidas/traslados de
// almacén de los roles operativos lo requieren. Prime y Administrador lo
// configuran aquí.
function PinCard({ txt }) {
  const [pin, setPin] = useState('');
  const { data } = useQuery({ queryKey: ['pin-estado'], queryFn: () => api.get('/api/autorizacion/pin') });
  const guardar = async () => {
    try {
      const r = await api.put('/api/autorizacion/pin', { pin });
      if (!r.ok) throw new Error(r.error);
      alert('✓ PIN actualizado'); setPin('');
    } catch (e) { handleApiError(e); }
  };
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-header"><h3>{txt('🔐 PIN de autorización')}</h3></div>
      <p style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 10 }}>
        Cajeros/operadores lo teclean para cancelar ventas o devolver; almacén para sacar/trasladar mercancía.
        {data?.configurado ? ' Estado: configurado ✓' : ' Estado: SIN configurar — esas operaciones estarán bloqueadas para los roles operativos.'}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <TextInput type="password" placeholder="Nuevo PIN (4-12 caracteres)" value={pin} onChange={e => setPin(e.target.value)} style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={guardar} disabled={pin.trim().length < 4}>Guardar</button>
      </div>
    </div>
  );
}

const MODULOS = [
  { key: 'puntos_activo', titulo: '⭐ Puntos de Lealtad', desc: 'Clientes acumulan puntos automáticamente por compra o por referido' },
  { key: 'ofertas_activo', titulo: '🏷️ Ofertas y Descuentos', desc: 'Bot muestra ofertas activas' },
  { key: 'upselling_activo', titulo: '💡 Upselling en carrito', desc: 'Sugerencias de productos complementarios' },
  { key: 'lista_espera_activo', titulo: '🔔 Lista de espera', desc: 'Notifica cuando llega stock esperado' },
  { key: 'carritos_activo', titulo: '🛒 Carritos abandonados', desc: 'Mensaje automático 2h después' },
  { key: 'vision_activo', titulo: '📸 Búsqueda por imagen', desc: 'Vision API para búsqueda con fotos' },
  { key: 'referidos_activo', titulo: '🤝 Programa de referidos', desc: 'Código de referido y puntos en la primera compra' },
  { key: 'pago_multimetodo_activo', titulo: '💳 Pago multi-método', desc: 'El bot ofrece efectivo/contra entrega, transferencia y link (no solo link)' },
  { key: 'entrega_pickup_activo', titulo: '🏪 Recoger en sucursal', desc: 'El bot ofrece pickup en tienda' },
  { key: 'entrega_paqueteria_activo', titulo: '📦 Envío por paquetería', desc: 'El bot ofrece envío a domicilio por paquetería (Estafeta)' },
  { key: 'entrega_repartidor_activo', titulo: '🛵 Repartidor propio', desc: 'Entrega local con tu repartidor; el negocio avisa "va en camino"' },
  { key: 'pos_activo', titulo: '🧾 Punto de venta (mostrador)', desc: 'Cobrar ventas presenciales y hacer corte de caja' },
  { key: 'facturacion_activo', titulo: '📄 Facturación', desc: 'Comprobante con datos fiscales y referencia (no todos los negocios facturan)' },
  { key: 'emojis_dashboard_activo', titulo: '🙂 Emojis en el dashboard', desc: 'Muestra u oculta los emojis en el panel (no afecta los mensajes del bot)' },
  { key: 'contabilidad_activo', titulo: '🏛️ Contabilidad (ERP)', desc: 'Asientos automáticos de cada venta/compra/pago en el libro mayor (ver ERP / Finanzas)' },
  { key: 'rrhh_activo', titulo: '🪪 Recursos Humanos', desc: 'Empleados, horarios por Excel y nómina MX (con/sin impuestos)' },
];

const TONOS = [
  { id: 'A', titulo: '👔 Formal', desc: 'Trato de usted, lenguaje corporativo. Para clientes mayores o B2B.', ejemplo: 'Bienvenido a Julio Cepeda Jugueterías. Es un gusto atenderle.' },
  { id: 'B', titulo: '😎 Casual', desc: 'Directo y breve. Mensajes cortos para respuestas rápidas.', ejemplo: '¡Hola! Soy el bot de Julio Cepeda. ¿Qué necesitas?' },
  { id: 'C', titulo: '🧸 Amigable', desc: 'Cálido y con emojis. Tono por defecto, equilibrado para todo público.', ejemplo: '¡Hola! Bienvenido a Julio Cepeda Jugueterías 🎉' },
  { id: 'D', titulo: '🎯 Ventas (23-40)', desc: 'Beneficio primero, urgencia honesta. Optimizado para conversión.', ejemplo: 'Llegaste a Julio Cepeda, 600 juguetes con entrega hoy mismo.' },
];

export default function Modulos() {
  const txt = useTextoEmoji();
  const queryClient = useQueryClient();

  const { data: estado } = useQuery({
    queryKey: ['modulos-estado'],
    queryFn: async () => {
      const rows = [];
      for (const m of MODULOS) {
        try {
          const r = await api.get(`/api/modulo/${m.key}`);
          rows.push({ key: m.key, activo: r && !r.error ? !!r.activo : true });
        } catch (_) { /* ignorar, mantiene la lista parcial */ }
      }
      return rows;
    },
  });

  const { data: tono } = useQuery({
    queryKey: ['tono'],
    queryFn: () => api.get('/api/tono').then(r => r?.tono || 'C').catch(() => 'C'),
  });

  const activoDe = (key) => estado?.find(r => r.key === key)?.activo ?? true;

  const toggleMutation = useMutation({
    mutationFn: ({ clave, activo }) => api.post('/api/puntos/config', { clave, activo }),
    onSuccess: (_data, { clave }) => {
      queryClient.invalidateQueries({ queryKey: ['modulos-estado'] });
      if (clave === 'emojis_dashboard_activo') queryClient.invalidateQueries({ queryKey: EMOJIS_ACTIVO_QUERY_KEY });
    },
    onError: (e) => handleApiError(e),
  });
  const toggle = (clave, activo) => {
    const accion = activo ? 'activar' : 'desactivar';
    if (!window.confirm(`¿Seguro que quieres ${accion} este módulo? Afecta a los clientes de inmediato.`)) return;
    toggleMutation.mutate({ clave, activo });
  };

  const cambiarTonoMutation = useMutation({
    mutationFn: (t) => api.post('/api/tono', { tono: t }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tono'] }),
  });
  const cambiarTono = (t) => cambiarTonoMutation.mutate(t);

  return (
    <div>
      <div className="page-title">Módulos</div>
      <div className="page-sub">Funciones del bot y modo de conversación</div>

      <div className="kpi-grid" style={{ gridTemplateColumns: '1.3fr 1fr', alignItems: 'start' }}>
        <div className="card">
          <div className="card-header"><h3>{txt('⚙️ Módulos del sistema')}</h3></div>
          <p style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 14 }}>Activa o desactiva funciones sin reiniciar el bot.</p>
          {MODULOS.map(m => (
            <div className="toggle-row" key={m.key}>
              <div className="info"><h4>{txt(m.titulo)}</h4><p>{m.desc}</p></div>
              <Switch checked={activoDe(m.key)} onChange={e => toggle(m.key, e.target.checked)} color="blue" />
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-header"><h3>{txt('📋 Estado de módulos')}</h3></div>
          {estado === undefined && <div className="empty">Cargando...</div>}
          {estado?.map(r => (
            <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
              <code style={{ fontSize: 12 }}>{r.key}</code>
              <span className={`badge badge-${r.activo ? 'verde' : 'rojo'}`}>{txt(r.activo ? '✅ Activo' : '⛔ Inactivo')}</span>
            </div>
          ))}
        </div>
      </div>

      <MetodosPagoCard txt={txt} />
          <PinCard txt={txt} />

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-header"><h3>{txt('🎭 Modo de conversación del bot')}</h3></div>
        <p style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 14 }}>Define el estilo con el que el bot le habla a los clientes. El cambio aplica en menos de 60 segundos, sin reiniciar el bot.</p>
        <div className="kpi-grid" style={{ gap: 10 }}>
          {TONOS.map(tonoOpt => (
            <div key={tonoOpt.id} className={`tono-opt${tono === tonoOpt.id ? ' sel' : ''}`} onClick={() => cambiarTono(tonoOpt.id)}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <h4>{txt(tonoOpt.titulo)}</h4>
                <span className="tono-check badge badge-verde">Activo</span>
              </div>
              <p>{tonoOpt.desc}</p>
              <em>"{tonoOpt.ejemplo}"</em>
            </div>
          ))}
        </div>
        {cambiarTonoMutation.isSuccess && <div className="card" style={{ marginTop: 12 }}>✅ Modo actualizado. Aplica en menos de 60 segundos.</div>}
        {cambiarTonoMutation.isError && <div className="login-error" style={{ marginTop: 12 }}>❌ {cambiarTonoMutation.error.message}</div>}
      </div>
    </div>
  );
}
