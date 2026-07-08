import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AppShell, Accordion } from '@mantine/core';
import { useAuth } from '../context/AuthContext';
import {
  Home, ReceiptText, Package, Undo2, MessagesSquare, MessageCircle,
  Truck, Send, BellRing, CalendarDays, Users, Trophy, Tag, Ticket,
  RefreshCw, Search, BarChart3, Tags, Settings, Star, FlaskConical,
  LogOut, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { api } from '../api';
import BotStatusWidget from './BotStatusWidget';
import ThemeSwitcher from './ThemeSwitcher';
import NotificationBell from './NotificationBell';
import SoporteWidget from './SoporteWidget';
import BuscadorGlobal from './BuscadorGlobal';
import { tieneRango } from '../lib/roles';

const GRUPOS = [
  { titulo: 'Operación diaria', enlaces: [
    { to: '/', label: 'Inicio', Icono: Home },
    { to: '/mostrador', label: 'Mostrador', Icono: ReceiptText, moduloRequerido: 'pos_activo' },
    { to: '/pedidos', label: 'Pedidos', Icono: Package },
    { to: '/devoluciones', label: 'Devoluciones', Icono: Undo2 },
    { to: '/cola', label: 'Cola de atención', Icono: MessagesSquare },
    { to: '/notificaciones', label: 'Chat y mensajes', Icono: MessageCircle },
  ]},
  { titulo: 'Envíos y logística', enlaces: [
    { to: '/guias', label: 'Guías Estafeta', Icono: Truck, rolRequerido: 'gerente' },
    { to: '/cola-envios', label: 'Cola de envíos', Icono: Send, rolRequerido: 'gerente' },
    { to: '/lista-espera', label: 'Lista de Espera', Icono: BellRing, rolRequerido: 'gerente' },
    { to: '/preventas', label: 'Preventas', Icono: CalendarDays, rolRequerido: 'gerente' },
  ]},
  { titulo: 'Clientes y fidelidad', enlaces: [
    { to: '/clientes', label: 'Clientes', Icono: Users },
    { to: '/ranking', label: 'Ranking', Icono: Trophy },
  ]},
  { titulo: 'Marketing', enlaces: [
    { to: '/ofertas', label: 'Ofertas', Icono: Tag, rolRequerido: 'gerente' },
    { to: '/cupones', label: 'Cupones', Icono: Ticket, rolRequerido: 'gerente' },
  ]},
  { titulo: 'Catálogo y datos', enlaces: [
    { to: '/sustitutos', label: 'Relacionados', Icono: RefreshCw, rolRequerido: 'gerente' },
    { to: '/busquedas', label: 'Búsquedas', Icono: Search, rolRequerido: 'gerente' },
    { to: '/metricas', label: 'Métricas', Icono: BarChart3, rolRequerido: 'gerente' },
    { to: '/etiquetas', label: 'Etiquetas', Icono: Tags, rolRequerido: 'gerente' },
  ]},
  { titulo: 'Sistema', enlaces: [
    { to: '/modulos', label: 'Módulos', Icono: Settings, rolRequerido: 'gerente' },
    { to: '/prime', label: 'Gestión / Prime', Icono: Star, rolRequerido: 'gerente' },
    { to: '/beta', label: 'Beta / Pruebas', Icono: FlaskConical, rolRequerido: 'prime' },
  ]},
];

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
  const { data: posActivo } = useQuery({
    queryKey: ['modulo', 'pos_activo'],
    queryFn: () => api.get('/api/modulo/pos_activo').then(r => !!r.activo).catch(() => false),
  });
  const modulosActivos = { pos_activo: posActivo };
  // rolRequerido es rango mínimo, no match exacto
  const grupos = GRUPOS
    .map(g => ({ ...g, enlaces: g.enlaces.filter(e =>
      (!e.rolRequerido || tieneRango(user?.rol, e.rolRequerido)) &&
      (!e.moduloRequerido || modulosActivos[e.moduloRequerido])
    ) }))
    .filter(g => g.enlaces.length > 0);

  const [nombreNegocio, setNombreNegocio] = useState('Julio Cepeda');
  useEffect(() => {
    api.get('/api/negocio').then(d => d?.nombre_negocio && setNombreNegocio(d.nombre_negocio)).catch(() => {});
  }, []);

  const iniciales = (user?.username || '?').slice(0, 2).toUpperCase();

  // Sidebar colapsable a riel de iconos (persistido por navegador)
  const [colapsado, setColapsado] = useState(() => localStorage.getItem('jc-sidebar-colapsado') === '1');
  useEffect(() => { localStorage.setItem('jc-sidebar-colapsado', colapsado ? '1' : '0'); }, [colapsado]);
  const enlacesPlanos = grupos.flatMap(g => g.enlaces);

  // Acordeón de un grupo abierto a la vez, siempre el de la ruta activa
  // (todos expandidos desbordaban el alto del sidebar en laptops)
  const grupoActivo = grupos.find(g => g.enlaces.some(e => e.to === location.pathname))?.titulo || grupos[0]?.titulo;
  const [abierto, setAbierto] = useState(grupoActivo);
  useEffect(() => { setAbierto(grupoActivo); }, [grupoActivo]);

  // navbar sin breakpoint a propósito (sin versión móvil, es Electron/escritorio);
  // padding en el prop de AppShell, no en .content (pisaría el offset del navbar)
  return (
    <AppShell header={{ height: 64 }} navbar={{ width: colapsado ? 76 : 252 }} padding={28}>
      <AppShell.Header className="topbar">
        <div className="topbar-left">Panel de operaciones</div>
        <BuscadorGlobal />
        <div className="topbar-right">
          <ThemeSwitcher />
          <NotificationBell />
          <BotStatusWidget />
          <div className="avatar-chip" title={`${user?.username} · ${user?.rol}`}>{iniciales}</div>
        </div>
      </AppShell.Header>

      <AppShell.Navbar className={`sidebar${colapsado ? ' colapsado' : ''}`}>
        <div className="sidebar-top">
          {!colapsado && <div className="sidebar-brand">{nombreNegocio}</div>}
          <button className="sidebar-colapsar" title={colapsado ? 'Expandir menú' : 'Contraer menú'} onClick={() => setColapsado(v => !v)}>
            {colapsado ? <PanelLeftOpen size={17} strokeWidth={1.75} /> : <PanelLeftClose size={17} strokeWidth={1.75} />}
          </button>
        </div>
        <nav className="sidebar-nav">
          {colapsado ? (
            enlacesPlanos.map(e => (
              <NavLink key={e.to} to={e.to} title={e.label} className={({ isActive }) => `sidebar-link solo-icono${isActive ? ' active' : ''}`} end={e.to === '/'}>
                <e.Icono size={18} strokeWidth={1.75} />
              </NavLink>
            ))
          ) : (
            <Accordion value={abierto} onChange={setAbierto} chevronSize={14} styles={ACCORDION_STYLES}>
              {grupos.map(g => (
                <Accordion.Item value={g.titulo} key={g.titulo}>
                  <Accordion.Control>{g.titulo}</Accordion.Control>
                  <Accordion.Panel>
                    {g.enlaces.map(e => (
                      <NavLink key={e.to} to={e.to} className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`} end={e.to === '/'}>
                        <e.Icono size={16} strokeWidth={1.75} />{e.label}
                      </NavLink>
                    ))}
                  </Accordion.Panel>
                </Accordion.Item>
              ))}
            </Accordion>
          )}
        </nav>
        <div className="sidebar-foot">
          {!colapsado && (
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{user?.username}</span>
              <span className="sidebar-user-rol">{user?.rol}</span>
            </div>
          )}
          <button className="btn" title="Cerrar sesión" style={{ marginTop: 10, width: '100%', justifyContent: 'center' }} onClick={logout}>
            <LogOut size={14} strokeWidth={1.75} />{!colapsado && 'Cerrar sesión'}
          </button>
        </div>
      </AppShell.Navbar>

      <AppShell.Main className="content">
        <Outlet />
      </AppShell.Main>
      <SoporteWidget />
    </AppShell>
  );
}
