import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AppShell, Accordion } from '@mantine/core';
import { useAuth } from '../context/AuthContext';
import { Emoji } from '../context/EmojiContext';
import { api } from '../api';
import BotStatusWidget from './BotStatusWidget';
import ThemeSwitcher from './ThemeSwitcher';
import NotificationBell from './NotificationBell';
import SoporteWidget from './SoporteWidget';

// Antes era una sola lista plana de 20 enlaces — para un solo operador
// humano eso ya era carga cognitiva alta (hallazgo del comité de diseño/UX).
// Agrupado por área de trabajo, sin tocar rutas ni nada del backend.
const GRUPOS = [
  { titulo: 'Operación diaria', enlaces: [
    { to: '/', label: 'Inicio', icon: '🏠' },
    { to: '/pedidos', label: 'Pedidos', icon: '📦' },
    { to: '/devoluciones', label: 'Devoluciones', icon: '↩️' },
    { to: '/cola', label: 'Cola de atención', icon: '🗨️' },
    // Antes vivía en "Marketing" (era solo broadcast) -- ahora es el centro
    // de chat en vivo con clientes escalados (ver Notificaciones.jsx), así
    // que pasa a este grupo junto con el resto de la operación diaria.
    { to: '/notificaciones', label: 'Operación diaria', icon: '💬' },
  ]},
  { titulo: 'Envíos y logística', enlaces: [
    { to: '/guias', label: 'Guías Estafeta', icon: '🚚' },
    { to: '/cola-envios', label: 'Cola de envíos', icon: '📨' },
    { to: '/lista-espera', label: 'Lista de Espera', icon: '🔔' },
    { to: '/preventas', label: 'Preventas', icon: '📅' },
  ]},
  { titulo: 'Clientes y fidelidad', enlaces: [
    { to: '/clientes', label: 'Clientes', icon: '👥' },
    { to: '/ranking', label: 'Ranking', icon: '🏆' },
  ]},
  { titulo: 'Marketing', enlaces: [
    { to: '/ofertas', label: 'Ofertas', icon: '🏷️' },
    { to: '/cupones', label: 'Cupones', icon: '🎟️' },
  ]},
  { titulo: 'Catálogo y datos', enlaces: [
    { to: '/sustitutos', label: 'Relacionados', icon: '🔄' },
    { to: '/busquedas', label: 'Búsquedas', icon: '🔍' },
    { to: '/metricas', label: 'Métricas', icon: '📊' },
    { to: '/etiquetas', label: 'Etiquetas', icon: '🏷️' },
  ]},
  { titulo: 'Sistema', enlaces: [
    { to: '/modulos', label: 'Módulos', icon: '⚙️' },
    { to: '/beta', label: 'Beta / Pruebas', icon: '🧪', rolRequerido: 'prime' },
    { to: '/prime', label: 'Prime', icon: '⭐', rolRequerido: 'prime' },
  ]},
];

// Mantine Accordion estilizado para verse como las secciones de siempre
// (título compacto en mayúsculas) en vez del look "card" por default —
// solo cambia el contenedor, no los enlaces de adentro.
const ACCORDION_STYLES = {
  item: { border: 'none', background: 'transparent' },
  control: { padding: '10px 8px', minWidth: 0 },
  label: {
    fontSize: 12, fontWeight: 700, letterSpacing: '0.02em', color: 'var(--text-mute)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
  },
  chevron: { color: 'var(--text-mute)', flexShrink: 0 },
  panel: { padding: 0 },
  content: { padding: '0 0 4px' },
};

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const grupos = GRUPOS
    .map(g => ({ ...g, enlaces: g.enlaces.filter(e => !e.rolRequerido || e.rolRequerido === user?.rol) }))
    .filter(g => g.enlaces.length > 0);
  // Nombre del negocio editable desde Prime (revendible a otra juguetería) —
  // 'Julio Cepeda' es solo el placeholder mientras carga /api/negocio.
  const [nombreNegocio, setNombreNegocio] = useState('Julio Cepeda');

  useEffect(() => {
    api.get('/api/negocio').then(d => d?.nombre_negocio && setNombreNegocio(d.nombre_negocio)).catch(() => {});
  }, []);

  // Antes los 6 grupos (~20 enlaces) estaban siempre expandidos: en pantallas
  // de laptop el sidebar se volvía más alto que el contenido y rompía el
  // layout de la derecha (hallazgo directo del operador). Ahora es un
  // acordeón de un solo grupo abierto a la vez, y ese grupo es siempre el
  // que contiene la ruta activa — así nunca se "pierde" la página actual.
  const grupoActivo = grupos.find(g => g.enlaces.some(e => e.to === location.pathname))?.titulo || grupos[0]?.titulo;
  const [abierto, setAbierto] = useState(grupoActivo);
  useEffect(() => { setAbierto(grupoActivo); }, [grupoActivo]);

  // AppShell de Mantine (antes: 4 divs a mano con flex/position manual) —
  // mismas clases de siempre (sidebar/topbar/content) por dentro de cada
  // slot, así que la apariencia y los temas claro/oscuro (variables CSS de
  // styles.css) no cambian; lo que gana es el manejo de offsets/scroll de
  // header+navbar+main resuelto por Mantine en vez de a mano.
  //
  // Sin `breakpoint` en `navbar`: confirmado en el código fuente de Mantine
  // (assign-navbar-variables.ts) que CUALQUIER `breakpoint` truthy sin
  // `collapsed.mobile` agrega un `@media (max-width: breakpoint)` que pone
  // `--app-shell-navbar-offset: 0px` — es decir, el sidebar pasa a overlay
  // (se monta encima del contenido en vez de empujarlo) por debajo de ese
  // ancho, pensado para un Burger toggle que aquí no existe. Esta app es
  // una sola ventana de Electron sin versión móvil, así que no se necesita
  // ningún breakpoint — se omite (no 0, porque `breakpoint` debe ser
  // explícitamente falsy/ausente para que la condición nunca se cumpla).
  //
  // `padding={28}` en vez de 0: el prop suma este valor al offset del
  // navbar/header en el padding-inline-start/top calculado de
  // AppShell.Main (ver AppShell.module.css). Antes era padding={0} y el
  // padding de página se ponía en la clase `.content` — pero esa clase
  // sobrescribía por completo ese cálculo (mismo padding-left, cargada
  // después en el CSS), anulando el offset reservado para el sidebar.
  return (
    <AppShell header={{ height: 64 }} navbar={{ width: 252 }} padding={28}>
      <AppShell.Header className="topbar">
        <div className="topbar-left">Panel de operaciones</div>
        <div className="topbar-right">
          <ThemeSwitcher />
          <NotificationBell />
          <BotStatusWidget />
          <span className="hevcaz-badge-react">Hevcaz Solutions</span>
        </div>
      </AppShell.Header>

      <AppShell.Navbar className="sidebar">
        <div className="sidebar-brand">{nombreNegocio}</div>
        <nav className="sidebar-nav">
          <Accordion value={abierto} onChange={setAbierto} chevronSize={14} styles={ACCORDION_STYLES}>
            {grupos.map(g => (
              <Accordion.Item value={g.titulo} key={g.titulo}>
                <Accordion.Control>{g.titulo}</Accordion.Control>
                <Accordion.Panel>
                  {g.enlaces.map(e => (
                    <NavLink key={e.to} to={e.to} className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`} end={e.to === '/'}>
                      <Emoji><span>{e.icon}</span> </Emoji>{e.label}
                    </NavLink>
                  ))}
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        </nav>
        <div className="sidebar-foot">
          {user?.username} · {user?.rol}
          <div><button className="btn" style={{ marginTop: 10, width: '100%' }} onClick={logout}>Cerrar sesión</button></div>
        </div>
      </AppShell.Navbar>

      <AppShell.Main className="content">
        <Outlet />
      </AppShell.Main>
      <SoporteWidget />
    </AppShell>
  );
}
