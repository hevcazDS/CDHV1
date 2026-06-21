import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import BotStatusWidget from './BotStatusWidget';

const ENLACES = [
  { to: '/', label: 'Inicio', icon: '🏠' },
  { to: '/pedidos', label: 'Pedidos', icon: '📦' },
  { to: '/devoluciones', label: 'Devoluciones', icon: '↩️' },
  { to: '/clientes', label: 'Clientes', icon: '👥' },
  { to: '/guias', label: 'Guías Estafeta', icon: '🚚' },
  { to: '/cola', label: 'Cola de atención', icon: '🗨️' },
  { to: '/notificaciones', label: 'Notificaciones', icon: '📢' },
  { to: '/cola-envios', label: 'Cola de envíos', icon: '📨' },
  { to: '/metricas', label: 'Métricas', icon: '📊' },
  { to: '/lista-espera', label: 'Lista de Espera', icon: '🔔' },
  { to: '/preventas', label: 'Preventas', icon: '📅' },
  { to: '/ofertas', label: 'Ofertas', icon: '🏷️' },
  { to: '/promociones', label: 'Promociones', icon: '🎟️' },
  { to: '/sustitutos', label: 'Relacionados', icon: '🔄' },
  { to: '/puntos', label: 'Puntos QR', icon: '🔍' },
  { to: '/ranking', label: 'Ranking', icon: '🏆' },
  { to: '/modulos', label: 'Módulos', icon: '⚙️' },
  { to: '/busquedas', label: 'Búsquedas', icon: '🔍' },
  { to: '/beta', label: 'Beta / Pruebas', icon: '🧪' },
  { to: '/prime', label: 'Prime', icon: '⭐', rolRequerido: 'prime' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const enlaces = ENLACES.filter(e => !e.rolRequerido || e.rolRequerido === user?.rol);
  // Nombre del negocio editable desde Prime (revendible a otra juguetería) —
  // 'Julio Cepeda' es solo el placeholder mientras carga /api/negocio.
  const [nombreNegocio, setNombreNegocio] = useState('Julio Cepeda');

  useEffect(() => {
    api.get('/api/negocio').then(d => d?.nombre_negocio && setNombreNegocio(d.nombre_negocio)).catch(() => {});
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">{nombreNegocio}</div>
        <nav className="sidebar-nav">
          {enlaces.map(e => (
            <NavLink key={e.to} to={e.to} className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`} end={e.to === '/'}>
              <span>{e.icon}</span> {e.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          {user?.username} · {user?.rol}
          <div><button className="btn" style={{ marginTop: 10, width: '100%' }} onClick={logout}>Cerrar sesión</button></div>
        </div>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <div className="topbar-left">Panel de operaciones</div>
          <div className="topbar-right">
            <BotStatusWidget />
            <span className="hevcaz-badge-react">Hevcaz Solutions</span>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
