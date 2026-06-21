import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Inicio() {
  const [pedidos, setPedidos] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/pedidos').then(setPedidos).catch(e => setError(e.message));
    // emails_error no tenía ningún lugar en el dashboard donde verse — antes
    // un correo de confirmación fallido solo era visible consultando SQL
    // directo (ver dashboard/server.js /api/stats).
    api.get('/api/stats').then(setStats).catch(() => {});
  }, []);

  const total = pedidos?.length || 0;
  const pendientes = pedidos?.filter(p => p.estatus !== 'entregado' && p.estatus !== 'cancelado').length || 0;
  const emailsError = stats?.emails_error || 0;

  return (
    <div>
      <div className="page-title">Inicio</div>
      <div className="page-sub">Resumen general de la operación</div>
      {error && <div className="login-error" style={{ marginBottom: 20 }}>No se pudieron cargar los pedidos: {error}</div>}
      <div className="kpi-grid">
        <div className="card kpi-card">
          <span className="kpi-label">Pedidos (últimos 100)</span>
          <span className="kpi-value">{total}</span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Pendientes</span>
          <span className="kpi-value">{pendientes}</span>
        </div>
        {emailsError > 0 && (
          <div className="card kpi-card" style={{ borderColor: 'var(--red)' }}>
            <span className="kpi-label">⚠️ Emails con error</span>
            <span className="kpi-value">{emailsError}</span>
          </div>
        )}
      </div>
    </div>
  );
}
