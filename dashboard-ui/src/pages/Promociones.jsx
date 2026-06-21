import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fmt } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import { useTextoEmoji } from '../context/EmojiContext';

export default function Promociones() {
  const txt = useTextoEmoji();
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = useState('');
  const [codigo, setCodigo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [tipo, setTipo] = useState('porcentaje');
  const [valor, setValor] = useState('');
  const [idProducto, setIdProducto] = useState('');
  const [idCategoria, setIdCategoria] = useState('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [usosMax, setUsosMax] = useState('0');
  const [msg, setMsg] = useState(null);

  const { data: rows, error, refetch } = useQuery({
    queryKey: ['promociones', filtro],
    queryFn: () => api.get('/api/promociones' + (filtro !== '' ? '?activa=' + filtro : '')),
  });

  const crearMutation = useMutation({
    mutationFn: (body) => api.post('/api/promociones', body),
    onSuccess: () => {
      setMsg({ ok: true, texto: '✅ Cupón creado' });
      setCodigo(''); setDescripcion(''); setValor(''); setIdProducto(''); setIdCategoria(''); setFechaInicio(''); setFechaFin('');
      queryClient.invalidateQueries({ queryKey: ['promociones'] });
    },
    onError: (e) => setMsg({ ok: false, texto: '❌ ' + e.message }),
  });
  const crear = () => {
    const body = {
      codigo, descripcion: descripcion || null, tipo, valor: parseFloat(valor || 0),
      id_producto: parseInt(idProducto || 0) || null,
      id_categoria: parseInt(idCategoria || 0) || null,
      fecha_inicio: fechaInicio || null, fecha_fin: fechaFin || null,
      usos_max: parseInt(usosMax || 0),
    };
    if (!body.codigo || !body.valor) { setMsg({ ok: false, texto: 'Completa código y valor' }); return; }
    crearMutation.mutate(body);
  };

  const toggleMutation = useMutation({
    mutationFn: ({ id, activa }) => api.put(`/api/promociones/${id}`, { activa: !!activa }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['promociones'] }),
    onError: (e) => handleApiError(e),
  });
  const toggle = (id, activa) => {
    if (!window.confirm(`¿Seguro que quieres ${activa ? 'activar' : 'desactivar'} esta promoción?`)) return;
    toggleMutation.mutate({ id, activa });
  };

  return (
    <div>
      <div className="page-title">Promociones</div>
      <div className="page-sub">Cupones y descuentos manuales</div>
      {error && <div className="login-error">No se pudieron cargar las promociones: {error.message}</div>}

      <div className="kpi-grid" style={{ gridTemplateColumns: '1.4fr 1fr', alignItems: 'start' }}>
        <div className="card">
          <div className="card-header">
            <h3>{txt('🎟️ Cupones / Promociones')}</h3>
            <div className="actions">
              <select value={filtro} onChange={e => setFiltro(e.target.value)}>
                <option value="">Todas</option>
                <option value="1">Activas</option>
                <option value="0">Inactivas</option>
              </select>
              <button className="btn btn-secondary btn-sm" onClick={() => refetch()}>🔄</button>
            </div>
          </div>
          {rows === undefined && <div className="empty">Cargando...</div>}
          {rows?.length === 0 && <div className="empty">Sin cupones</div>}
          {rows?.map(r => {
            const val = r.tipo === 'porcentaje' ? `${r.valor}%` : `$${fmt(r.valor)}`;
            return (
              <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 7, padding: 12, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <strong><code>{r.codigo}</code></strong>
                  <span className={`badge badge-${r.activa ? 'verde' : 'rojo'}`}>{r.activa ? 'Activa' : 'Inactiva'}</span>
                </div>
                <div className="text-muted">{r.descripcion || 'Sin descripción'}</div>
                <div className="text-muted">Descuento: <strong>{val}</strong>{r.nombre_producto ? ` · ${r.nombre_producto}` : ''}</div>
                <div className="text-muted">Vigencia: {r.fecha_inicio || '-'} a {r.fecha_fin || 'Sin vencimiento'} · Usos: {r.usos_actual || 0}/{r.usos_max || '∞'}</div>
                <button className={`btn btn-sm ${r.activa ? 'btn-danger' : 'btn-success'}`} style={{ marginTop: 7 }} onClick={() => toggle(r.id, r.activa ? 0 : 1)}>
                  {txt(r.activa ? '🚫 Desactivar' : '✅ Activar')}
                </button>
              </div>
            );
          })}
        </div>

        <div className="card">
          <div className="card-header"><h3>{txt('➕ Nuevo cupón')}</h3></div>
          <div className="login-field">
            <label>Código</label>
            <input placeholder="Ej: VERANO10" value={codigo} onChange={e => setCodigo(e.target.value)} />
          </div>
          <div className="login-field">
            <label>Descripción</label>
            <input placeholder="Ej: 10% en toda la tienda" value={descripcion} onChange={e => setDescripcion(e.target.value)} />
          </div>
          <div className="login-field">
            <label>Tipo</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)} style={{ width: '100%' }}>
              <option value="porcentaje">% Porcentaje</option>
              <option value="monto">$ Monto fijo</option>
            </select>
          </div>
          <div className="login-field">
            <label>Valor</label>
            <input type="number" step="0.01" value={valor} onChange={e => setValor(e.target.value)} />
          </div>
          <div className="login-field">
            <label>ID Producto (opcional)</label>
            <input type="number" value={idProducto} onChange={e => setIdProducto(e.target.value)} />
          </div>
          <div className="login-field">
            <label>ID Categoría (opcional)</label>
            <input type="number" value={idCategoria} onChange={e => setIdCategoria(e.target.value)} />
          </div>
          <div className="login-field">
            <label>Fecha inicio (opcional)</label>
            <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} />
          </div>
          <div className="login-field">
            <label>Fecha fin (opcional)</label>
            <input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)} />
          </div>
          <div className="login-field">
            <label>Usos máximos (0 = ilimitado)</label>
            <input type="number" value={usosMax} onChange={e => setUsosMax(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={crear}>Crear cupón</button>
          {msg && <div className={msg.ok ? 'card' : 'login-error'} style={{ marginTop: 14 }}>{txt(msg.texto)}</div>}
        </div>
      </div>
    </div>
  );
}
