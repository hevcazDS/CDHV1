import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Inicio() {
  const [pedidos, setPedidos] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/pedidos').then(setPedidos).catch(e => setError(e.message));
  }, []);

  const total = pedidos?.length || 0;
  const pendientes = pedidos?.filter(p => p.estatus !== 'entregado' && p.estatus !== 'cancelado').length || 0;

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
      </div>
    </div>
  );
}
