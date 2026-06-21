import { useEffect, useState } from 'react';
import { api } from '../api';
import { fdate, soloTelefono } from '../lib/format';

const MEDALLA = ['🥇', '🥈', '🥉'];

export default function Ranking() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  const cargar = () => {
    api.get('/api/puntos/ranking').then(setRows).catch(e => setError(e.message));
  };
  useEffect(cargar, []);

  return (
    <div>
      <div className="page-title">Ranking</div>
      <div className="page-sub">Top clientes por puntos de lealtad</div>
      {error && <div className="login-error">No se pudo cargar el ranking: {error}</div>}

      <div className="card">
        <div className="card-header">
          <h3>🏆 Top clientes por puntos</h3>
          <div className="actions"><button className="btn btn-secondary btn-sm" onClick={cargar}>🔄</button></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Cliente</th><th>Teléfono</th><th>Puntos ganados</th><th>Disponibles</th><th>Canjeados</th><th>Último mov.</th></tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan={7} className="empty">Cargando...</td></tr>}
              {rows?.length === 0 && <tr><td colSpan={7} className="empty">Sin datos de puntos aún</td></tr>}
              {rows?.map((r, i) => (
                <tr key={i}>
                  <td><strong>{MEDALLA[i] || i + 1}</strong></td>
                  <td>{r.nombre || '-'}</td>
                  <td><code style={{ fontSize: 11 }}>{soloTelefono(r.telefono)}</code></td>
                  <td>{r.puntos_ganados || 0}</td>
                  <td><strong style={{ color: 'var(--accent)' }}>{r.disponibles || 0}</strong></td>
                  <td>{r.puntos_canjeados || 0}</td>
                  <td className="text-muted" style={{ fontSize: 11 }}>{fdate(r.ultimo_movimiento)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
