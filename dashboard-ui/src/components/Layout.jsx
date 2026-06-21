import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import BotStatusWidget from './BotStatusWidget';

// Antes era una sola lista plana de 20 enlaces — para un solo operador
// humano eso ya era carga cognitiva alta (hallazgo del comité de diseño/UX).
// Agrupado por área de trabajo, sin tocar rutas ni nada del backend.
const GRUPOS = [
  { titulo: 'Operación diaria', enlaces: [
    { to: '/', label: 'Inicio', icon: '🏠' },
    { to: '/pedidos', label: 'Pedidos', icon: '📦' },
    { to: '/devoluciones', label: 'Devoluciones', icon: '↩️' },
    { to: '/cola', label: 'Cola de atención', icon: '🗨️' },
  ]},
  { titulo: 'Envíos y logística', enlaces: [
    { to: '/guias', label: 'Guías Estafeta', icon: '🚚' },
    { to: '/cola-envios', label: 'Cola de envíos', icon: '📨' },
    { to: '/lista-espera', label: 'Lista de Espera', icon: '🔔' },
    { to: '/preventas', label: 'Preventas', icon: '📅' },
  ]},
  { titulo: 'Clientes y fidelidad', enlaces: [
    { to: '/clientes', label: 'Clientes', icon: '👥' },
    { to: '/puntos', label: 'Puntos QR', icon: '🔍' },
    { to: '/ranking', label: 'Ranking', icon: '🏆' },
  ]},
  { titulo: 'Marketing', enlaces: [
    { to: '/ofertas', label: 'Ofertas', icon: '🏷️' },
    { to: '/promociones', label: 'Promociones', icon: '🎟️' },
    { to: '/notificaciones', label: 'Notificaciones', icon: '📢' },
  ]},
  { titulo: 'Catálogo y datos', enlaces: [
    { to: '/sustitutos', label: 'Relacionados', icon: '🔄' },
    { to: '/busquedas', label: 'Búsquedas', icon: '🔍' },
    { to: '/metricas', label: 'Métricas', icon: '📊' },
  ]},
  { titulo: 'Sistema', enlaces: [
    { to: '/modulos', label: 'Módulos', icon: '⚙️' },
    { to: '/beta', label: 'Beta / Pruebas', icon: '🧪' },
    { to: '/prime', label: 'Prime', icon: '⭐', rolRequerido: 'prime' },
  ]},
];

export default function Layout() {
  const { user, logout } = useAuth();
  const grupos = GRUPOS
    .map(g => ({ ...g, enlaces: g.enlaces.filter(e => !e.rolRequerido || e.rolRequerido === user?.rol) }))
    .filter(g => g.enlaces.length > 0);
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
          {grupos.map(g => (
            <div className="sidebar-group" key={g.titulo}>
              <div className="sidebar-group-title">{g.titulo}</div>
              {g.enlaces.map(e => (
                <NavLink key={e.to} to={e.to} className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`} end={e.to === '/'}>
                  <span>{e.icon}</span> {e.label}
                </NavLink>
              ))}
            </div>
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
