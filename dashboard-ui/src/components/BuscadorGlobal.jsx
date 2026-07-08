import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users, Package, Tag } from 'lucide-react';
import { api } from '../api';
import { soloTelefono } from '../lib/format';

// Buscador global del topbar: clientes, pedidos (folio) y productos.
export default function BuscadorGlobal() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [abierto, setAbierto] = useState(false);
  const ref = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setRes(null); return; }
    timer.current = setTimeout(() => {
      api.get('/api/buscar?q=' + encodeURIComponent(q.trim()))
        .then(r => { setRes(r); setAbierto(true); })
        .catch(() => setRes(null));
    }, 300);
    return () => clearTimeout(timer.current);
  }, [q]);

  useEffect(() => {
    function fuera(e) { if (ref.current && !ref.current.contains(e.target)) setAbierto(false); }
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, []);

  const ir = (ruta) => { setAbierto(false); setQ(''); navigate(ruta); };
  const hay = res && (res.clientes?.length || res.pedidos?.length || res.productos?.length);

  return (
    <div className="buscador" ref={ref}>
      <Search size={15} strokeWidth={1.75} className="buscador-icono" />
      <input
        className="buscador-input"
        placeholder="Buscar cliente, folio o producto..."
        value={q}
        onChange={e => setQ(e.target.value)}
        onFocus={() => res && setAbierto(true)}
      />
      {abierto && res && (
        <div className="buscador-drop">
          {!hay && <div className="buscador-vacio">Sin resultados para “{q}”</div>}
          {res.clientes?.length > 0 && <div className="buscador-seccion"><Users size={12} /> Clientes</div>}
          {res.clientes?.map(c => (
            <button key={'c' + c.id} className="buscador-item" onClick={() => ir('/clientes')}>
              <strong>{c.nombre || 'Sin nombre'}</strong><span>{soloTelefono(c.telefono)}</span>
            </button>
          ))}
          {res.pedidos?.length > 0 && <div className="buscador-seccion"><Package size={12} /> Pedidos</div>}
          {res.pedidos?.map(pd => (
            <button key={'p' + pd.id_pedido} className="buscador-item" onClick={() => ir('/pedidos')}>
              <strong>{pd.folio}</strong><span>{pd.cliente || '-'} · {pd.estatus}{pd.total ? ' · $' + Number(pd.total).toFixed(2) : ''}</span>
            </button>
          ))}
          {res.productos?.length > 0 && <div className="buscador-seccion"><Tag size={12} /> Productos</div>}
          {res.productos?.map(pr => (
            <button key={'x' + pr.id} className="buscador-item" onClick={() => setAbierto(false)}>
              <strong>{pr.name}</strong><span>${Number(pr.price).toFixed(2)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
