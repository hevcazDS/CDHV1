import { useState } from 'react';
import { api } from '../api';
import { fmt } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import { Emoji, useTextoEmoji } from '../context/EmojiContext';

export default function Sustitutos() {
  const txt = useTextoEmoji();
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState(null);
  const [base, setBase] = useState(null);
  const [relacionados, setRelacionados] = useState(null);
  const [qVincular, setQVincular] = useState('');
  const [resultadosVincular, setResultadosVincular] = useState(null);

  const buscar = (valor) => {
    setQ(valor);
    if (valor.trim().length < 2) { setResultados(null); return; }
    api.get('/api/productos/buscar?q=' + encodeURIComponent(valor)).then(setResultados).catch(() => {});
  };

  const cargarSustitutos = (id, nombre) => {
    setBase({ id, nombre });
    setQVincular(''); setResultadosVincular(null);
    api.get(`/api/sustitutos/${id}`).then(setRelacionados).catch(() => setRelacionados([]));
  };

  const buscarParaVincular = (valor) => {
    setQVincular(valor);
    if (valor.trim().length < 2) { setResultadosVincular(null); return; }
    api.get('/api/productos/buscar?q=' + encodeURIComponent(valor)).then(r => setResultadosVincular(r.slice(0, 5))).catch(() => {});
  };

  const vincular = async (idSust) => {
    try {
      await api.post('/api/sustitutos', { id_producto: base.id, id_sustituto: idSust, score: 8 });
      setQVincular(''); setResultadosVincular(null);
      cargarSustitutos(base.id, base.nombre);
    } catch (e) { handleApiError(e); }
  };

  const eliminar = async (id) => {
    if (!window.confirm('¿Eliminar esta relación?')) return;
    try { await api.del(`/api/sustitutos/${id}`); cargarSustitutos(base.id, base.nombre); }
    catch (e) { handleApiError(e); }
  };

  return (
    <div>
      <div className="page-title">Relacionados</div>
      <div className="page-sub">Productos sustitutos sugeridos cuando hay quiebre de stock</div>

      <div className="kpi-grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        <div className="card">
          <div className="card-header"><h3>{txt('🔍 Buscar producto')}</h3></div>
          <div className="login-field">
            <label>Nombre</label>
            <input placeholder="Ej: Hot Wheels" value={q} onChange={e => buscar(e.target.value)} />
          </div>
          {resultados === null && <div className="empty">Escribe para buscar...</div>}
          {resultados?.length === 0 && <div className="empty">Sin resultados</div>}
          {resultados?.map(r => (
            <div key={r.id} onClick={() => cargarSustitutos(r.id, r.name)}
              style={{ padding: '7px 9px', cursor: 'pointer', borderRadius: 5, borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <strong>{r.name}</strong><br /><span className="text-muted">${fmt(r.price)}</span>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-header"><h3>{txt('🔄 Productos relacionados')}</h3></div>
          {!base && <div className="empty">Selecciona un producto</div>}
          {base && (
            <>
              <strong style={{ fontSize: 13 }}>{base.nombre}</strong>
              <div style={{ margin: '8px 0', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                {relacionados === null && <div className="empty">Cargando...</div>}
                {relacionados?.length === 0 && <div className="empty">Sin relacionados definidos</div>}
                {relacionados?.map(r => (
                  <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                    <div><strong>{r.name}</strong><br /><span className="text-muted">${fmt(r.price)} · Score {r.score || 0}</span></div>
                    <button className="btn btn-danger btn-sm" onClick={() => eliminar(r.id)}>✕</button>
                  </div>
                ))}
              </div>
              <input placeholder="Buscar producto a vincular..." value={qVincular} onChange={e => buscarParaVincular(e.target.value)} style={{ marginTop: 8, width: '100%' }} />
              {resultadosVincular?.map(r => (
                <div key={r.id} onClick={() => vincular(r.id)} style={{ padding: '5px 9px', cursor: 'pointer', fontSize: 12, borderRadius: 4 }}>
                  <Emoji>➕ </Emoji>{r.name} - ${fmt(r.price)}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
