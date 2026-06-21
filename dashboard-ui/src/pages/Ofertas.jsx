import { useEffect, useState } from 'react';
import { api } from '../api';
import { fmt } from '../lib/format';
import { useTextoEmoji } from '../context/EmojiContext';

export default function Ofertas() {
  const txt = useTextoEmoji();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  const cargar = () => {
    api.get('/api/ofertas').then(setRows).catch(e => setError(e.message));
  };
  useEffect(cargar, []);

  return (
    <div>
      <div className="page-title">Ofertas</div>
      <div className="page-sub">Ofertas activas con precio rebajado</div>
      {error && <div className="login-error">No se pudieron cargar las ofertas: {error}</div>}

      <div className="card">
        <div className="card-header">
          <h3>{txt('🏷️ Ofertas activas')}</h3>
          <div className="actions"><button className="btn btn-secondary btn-sm" onClick={cargar}>🔄</button></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Código</th><th>Producto</th><th>Descuento</th><th>Precio oferta</th><th>Vence</th><th>Usos</th></tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan={6} className="empty">Cargando...</td></tr>}
              {rows?.length === 0 && <tr><td colSpan={6} className="empty">Sin ofertas activas</td></tr>}
              {rows?.map(r => (
                <tr key={r.id}>
                  <td><code>{r.codigo || '-'}</code></td>
                  <td style={{ fontSize: 12 }}>{r.nombre || '-'}</td>
                  <td><span className="badge badge-amarillo">-{r.valor || 0}{r.tipo === 'porcentaje' ? '%' : '$'}</span></td>
                  <td><strong>${fmt(r.precio_oferta)}</strong></td>
                  <td className="text-muted">{r.fecha_fin || 'Sin vencimiento'}</td>
                  <td>{r.usos_actual || 0}/{r.usos_max || '∞'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
