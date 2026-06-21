import { useEffect, useState } from 'react';
import { api } from '../api';
import { fdate } from '../lib/format';
import { useTextoEmoji } from '../context/EmojiContext';

export default function Busquedas() {
  const txt = useTextoEmoji();
  const [filas, setFilas] = useState(null);

  const cargar = () => api.get('/api/busquedas').then(setFilas).catch(() => setFilas([]));
  useEffect(cargar, []);

  return (
    <div>
      <div className="page-title">Búsquedas</div>
      <div className="page-sub">Términos que los clientes buscan en el bot</div>

      <div className="card">
        <div className="card-header">
          <h3>{txt('🔍 Log de búsquedas')}</h3>
          <div className="actions"><button className="btn btn-secondary btn-sm" onClick={cargar}>🔄</button></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Término buscado</th><th>Veces</th><th>Compras</th><th>Última búsqueda</th></tr></thead>
            <tbody>
              {filas === null && <tr><td colSpan={4} className="empty">Cargando...</td></tr>}
              {filas?.length === 0 && <tr><td colSpan={4} className="empty">Sin búsquedas registradas</td></tr>}
              {filas?.map((r, i) => (
                <tr key={i}>
                  <td>{r.busqueda}</td>
                  <td><strong>{r.veces}</strong></td>
                  <td>{r.compras != null ? r.compras : <span className="text-muted">—</span>}</td>
                  <td className="text-muted" style={{ fontSize: 11 }}>{fdate(r.ultima_vez)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
