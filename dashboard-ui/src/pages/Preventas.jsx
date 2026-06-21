import { useEffect, useState } from 'react';
import { api } from '../api';
import { fmt } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import Modal from '../components/Modal';
import { useTextoEmoji } from '../context/EmojiContext';

const hoy = () => new Date().toISOString().slice(0, 10);

export default function Preventas() {
  const txt = useTextoEmoji();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [idProducto, setIdProducto] = useState('');
  const [nombre, setNombre] = useState('');
  const [fechaEst, setFechaEst] = useState('');
  const [precio, setPrecio] = useState('');
  const [stock, setStock] = useState('50');
  const [anticipo, setAnticipo] = useState('50');
  const [msg, setMsg] = useState(null);
  const [llegadaId, setLlegadaId] = useState(null);
  const [fechaLlegada, setFechaLlegada] = useState(hoy());

  const cargar = () => {
    api.get('/api/preventas').then(setRows).catch(e => setError(e.message));
  };
  useEffect(cargar, []);

  const crear = async () => {
    const body = {
      id_producto: parseInt(idProducto || 0),
      nombre_preventa: nombre,
      fecha_llegada_est: fechaEst,
      precio_preventa: parseFloat(precio || 0),
      stock_maximo: parseInt(stock || 50),
      porcentaje_anticipo: parseInt(anticipo || 50),
    };
    if (!body.id_producto || !body.nombre_preventa || !body.fecha_llegada_est) {
      setMsg({ ok: false, texto: 'Completa los campos requeridos' }); return;
    }
    try {
      await api.post('/api/preventas', body);
      setMsg({ ok: true, texto: '✅ Preventa creada' });
      setIdProducto(''); setNombre(''); setFechaEst(''); setPrecio(''); setStock('50'); setAnticipo('50');
      cargar();
    } catch (e) { setMsg({ ok: false, texto: '❌ ' + e.message }); }
  };

  const confirmarLlegada = async () => {
    try {
      await api.put(`/api/preventas/${llegadaId}`, { fecha_llegada_real: fechaLlegada });
      setLlegadaId(null);
      cargar();
    } catch (e) { handleApiError(e); }
  };

  return (
    <div>
      <div className="page-title">Preventas</div>
      <div className="page-sub">Productos en preventa con apartado anticipado</div>
      {error && <div className="login-error">No se pudieron cargar las preventas: {error}</div>}

      <div className="kpi-grid" style={{ gridTemplateColumns: '1.4fr 1fr', alignItems: 'start' }}>
        <div className="card">
          <div className="card-header">
            <h3>{txt('📅 Preventas activas')}</h3>
            <div className="actions"><button className="btn btn-secondary btn-sm" onClick={cargar}>🔄</button></div>
          </div>
          {rows === null && <div className="empty">Cargando...</div>}
          {rows?.length === 0 && <div className="empty">Sin preventas activas</div>}
          {rows?.map(r => (
            <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 7, padding: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <strong>{r.nombre_preventa}</strong>
                <span className="badge badge-azul">{r.stock_comprometido || 0}/{r.stock_maximo || 0} apartados</span>
              </div>
              <div className="text-muted">ID: {r.id_producto} · ${fmt(r.precio_preventa)} · Anticipo {r.porcentaje_anticipo || 50}%</div>
              <div className="text-muted">Llegada estimada: {r.fecha_llegada_est || '-'}</div>
              {r.fecha_llegada_real
                ? <span className="badge badge-verde">{txt('✅ Llegó: ')}{r.fecha_llegada_real}</span>
                : <button className="btn btn-success btn-sm" style={{ marginTop: 7 }} onClick={() => { setLlegadaId(r.id); setFechaLlegada(hoy()); }}>{txt('✅ Marcar como llegada')}</button>}
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-header"><h3>{txt('➕ Nueva preventa')}</h3></div>
          <div className="login-field">
            <label>ID Producto</label>
            <input type="number" value={idProducto} onChange={e => setIdProducto(e.target.value)} />
          </div>
          <div className="login-field">
            <label>Nombre</label>
            <input placeholder="Ej: Hot Wheels Navidad 2026" value={nombre} onChange={e => setNombre(e.target.value)} />
          </div>
          <div className="login-field">
            <label>Fecha estimada llegada</label>
            <input type="date" value={fechaEst} onChange={e => setFechaEst(e.target.value)} />
          </div>
          <div className="login-field">
            <label>Precio</label>
            <input type="number" step="0.01" value={precio} onChange={e => setPrecio(e.target.value)} />
          </div>
          <div className="login-field">
            <label>Unidades disponibles</label>
            <input type="number" value={stock} onChange={e => setStock(e.target.value)} />
          </div>
          <div className="login-field">
            <label>Anticipo %</label>
            <input type="number" min="10" max="100" value={anticipo} onChange={e => setAnticipo(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={crear}>Crear preventa</button>
          {msg && <div className={msg.ok ? 'card' : 'login-error'} style={{ marginTop: 14 }}>{txt(msg.texto)}</div>}
        </div>
      </div>

      {llegadaId && (
        <Modal title="Fecha de llegada" onClose={() => setLlegadaId(null)}
          actions={<>
            <button className="btn btn-secondary" onClick={() => setLlegadaId(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={confirmarLlegada}>Aceptar</button>
          </>}>
          <p className="page-sub" style={{ margin: '0 0 12px' }}>Ingresa la fecha real de llegada</p>
          <input type="date" autoFocus value={fechaLlegada} onChange={e => setFechaLlegada(e.target.value)} style={{ width: '100%' }} />
        </Modal>
      )}
    </div>
  );
}
