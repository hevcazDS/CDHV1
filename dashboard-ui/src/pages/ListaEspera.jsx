import { useEffect, useState } from 'react';
import { api } from '../api';
import { fmt } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import { useTextoEmoji } from '../context/EmojiContext';

export default function ListaEspera() {
  const txt = useTextoEmoji();
  const [lista, setLista] = useState(null);
  const [error, setError] = useState('');

  const cargar = () => {
    api.get('/api/lista-espera').then(d => setLista(d.lista || [])).catch(e => setError(e.message));
  };
  useEffect(cargar, []);

  const notificar = async (idProducto, total) => {
    if (!window.confirm(`¿Notificar a ${total || 0} persona(s) que este producto ya tiene stock?`)) return;
    try {
      const r = await api.post(`/api/notificar-lista/${idProducto}`);
      window.alert(txt(`✅ ${r.notificados || 0} notificados`));
    } catch (e) { handleApiError(e, 'Error al notificar'); }
    cargar();
  };

  return (
    <div>
      <div className="page-title">Lista de Espera</div>
      <div className="page-sub">Clientes esperando que vuelva el stock</div>
      {error && <div className="login-error">No se pudo cargar la lista de espera: {error}</div>}

      <div className="card">
        <div className="card-header">
          <h3>{txt('🔔 Lista de espera')}</h3>
          <div className="actions"><button className="btn btn-secondary btn-sm" onClick={cargar}>🔄</button></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Producto</th><th>Precio</th><th>Stock</th><th>En espera</th><th>Acción</th></tr></thead>
            <tbody>
              {lista === null && <tr><td colSpan={5} className="empty">Cargando...</td></tr>}
              {lista?.length === 0 && <tr><td colSpan={5} className="empty">Sin clientes en espera</td></tr>}
              {lista?.map((p, i) => {
                const conStock = p.stock_tienda > 0 || p.stock_cedis > 0;
                const n = p.esperas ? p.esperas.length : 0;
                const idProducto = p.esperas?.[0]?.id_producto || 0;
                return (
                  <tr key={i}>
                    <td><strong>{p.nombre || '-'}</strong></td>
                    <td>${fmt(p.precio)}</td>
                    <td><span className={`badge badge-${conStock ? 'verde' : 'rojo'}`}>{conStock ? 'Con stock' : 'Sin stock'}</span></td>
                    <td><strong>{n}</strong> personas</td>
                    <td><button className="btn btn-success btn-sm" onClick={() => notificar(idProducto, n)}>{txt('📲 Notificar')}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
