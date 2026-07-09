import { useEffect, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AppShell, Accordion } from '@mantine/core';
import { useAuth } from '../context/AuthContext';
import {
  Home, ReceiptText, Package, Undo2, MessagesSquare, MessageCircle,
  Truck, Send, BellRing, CalendarDays, Users, Trophy, Tag, Ticket,
  RefreshCw, Search, BarChart3, Tags, Settings, Star, FlaskConical,
  LogOut, Landmark, Warehouse, ShoppingCart, IdCard,
} from 'lucide-react';
import { api } from '../api';
import BotStatusWidget from './BotStatusWidget';
import ThemeSwitcher from './ThemeSwitcher';
import NotificationBell from './NotificationBell';
import SoporteWidget from './SoporteWidget';
import BuscadorGlobal from './BuscadorGlobal';
import { tieneRango } from '../lib/roles';
import { permite, etiquetaRol, esAuditor } from '../lib/permisos';

const GRUPOS = [
  { titulo: 'Operación diaria', enlaces: [
    { to: '/', label: 'Inicio', Icono: Home },
    { to: '/mostrador', label: 'Mostrador', Icono: ReceiptText, moduloRequerido: 'pos_activo', area: 'pos' },
    { to: '/pedidos', area: 'operacion', label: 'Pedidos', Icono: Package },
    { to: '/devoluciones', area: 'operacion', label: 'Devoluciones', Icono: Undo2 },
    { to: '/cola', area: 'operacion', label: 'Cola de atención', Icono: MessagesSquare },
      { to: '/citas', label: 'Citas', area: 'operacion', moduloRequerido: 'citas_activo' },
    { to: '/notificaciones', area: 'operacion', label: 'Chat y mensajes', Icono: MessageCircle },
  ]},
  { titulo: 'Envíos y logística', enlaces: [
    { to: '/guias', label: 'Guías Estafeta', Icono: Truck, rolRequerido: 'gerente' },
    { to: '/cola-envios', label: 'Cola de envíos', Icono: Send, rolRequerido: 'gerente' },
    { to: '/lista-espera', label: 'Lista de Espera', Icono: BellRing, rolRequerido: 'gerente' },
    { to: '/preventas', label: 'Preventas', Icono: CalendarDays, rolRequerido: 'gerente' },
  ]},
  { titulo: 'Clientes y fidelidad', enlaces: [
    { to: '/clientes', area: 'operacion', label: 'Clientes', Icono: Users },
    { to: '/ranking', area: 'operacion', label: 'Ranking', Icono: Trophy },
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
  { titulo: 'Finanzas', enlaces: [
    { to: '/erp', label: 'ERP / Finanzas', Icono: Landmark, area: 'finanzas' },
    { to: '/compras', label: 'Compras', Icono: ShoppingCart, area: 'compras' },
    { to: '/rrhh', label: 'Recursos Humanos', Icono: IdCard, area: 'rrhh', moduloRequerido: 'rrhh_activo' },
  ]},
  { titulo: 'Almacén', enlaces: [
    { to: '/almacen', label: 'Almacén', Icono: Warehouse, area: 'almacen' },
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
  const { data: rrhhActivo } = useQuery({
    queryKey: ['modulo', 'rrhh_activo'],
    queryFn: () => api.get('/api/modulo/rrhh_activo').then(r => !!r.activo).catch(() => false),
  });
  const modulosActivos = { pos_activo: posActivo, rrhh_activo: rrhhActivo };
  // rolRequerido es rango mínimo, no match exacto
  const grupos = GRUPOS
    .map(g => ({ ...g, enlaces: g.enlaces.filter(e => {
      // Auditor: lee todo excepto configuración (Módulos/Prime/Beta)
      const pasaRol = e.rolRequerido
        ? (tieneRango(user?.rol, e.rolRequerido) ||
           (esAuditor(user?.rol) && e.rolRequerido === 'gerente' && !['/prime', '/modulos'].includes(e.to)))
        : true;
      return pasaRol &&
        (!e.area || permite(user?.rol, e.area)) &&
        (!e.moduloRequerido || modulosActivos[e.moduloRequerido] ||
          // rh/contabilidad SIEMPRE ven su link de RRHH; la página avisa si el módulo está apagado
          (e.moduloRequerido === 'rrhh_activo' && ['rh', 'contabilidad'].includes(user?.rol)));
    }) }))
    .filter(g => g.enlaces.length > 0);

  const [nombreNegocio, setNombreNegocio] = useState('Julio Cepeda');
  useEffect(() => {
    api.get('/api/negocio').then(d => d?.nombre_negocio && setNombreNegocio(d.nombre_negocio)).catch(() => {});
  }, []);

  const iniciales = (user?.username || '?').slice(0, 2).toUpperCase();

  // Sidebar colapsable a riel de CATEGORÍAS (un icono por grupo; al tocar
  // se despliega un flyout con las páginas de esa categoría)
  const [colapsado, setColapsado] = useState(() => localStorage.getItem('jc-sidebar-colapsado') === '1');
  useEffect(() => { localStorage.setItem('jc-sidebar-colapsado', colapsado ? '1' : '0'); }, [colapsado]);
  const [flyout, setFlyout] = useState(null);
  const navRef = useRef(null);
  // Clic fuera del menú: se contrae solo (y cierra el submenú abierto)
  useEffect(() => {
    function fuera(e) {
      if (navRef.current && !navRef.current.contains(e.target)) {
        setFlyout(null);
        setColapsado(true);
      }
    }
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, []);
  // Monograma del negocio ("Julio Cepeda Jugueterías" → JC): es el botón
  // de contraer/extraer
  const monograma = nombreNegocio.split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
  const ICONO_CATEGORIA = {
    'Operación diaria': Home, 'Envíos y logística': Truck, 'Clientes y fidelidad': Users,
    'Marketing': Tag, 'Catálogo y datos': BarChart3, 'Finanzas': Landmark, 'Almacén': Warehouse, 'Sistema': Settings,
  };

  // Acordeón de un grupo abierto a la vez, siempre el de la ruta activa
  // (todos expandidos desbordaban el alto del sidebar en laptops)
  const grupoActivo = grupos.find(g => g.enlaces.some(e => e.to === location.pathname))?.titulo || grupos[0]?.titulo;
  const [abierto, setAbierto] = useState(grupoActivo);
  useEffect(() => { setAbierto(grupoActivo); }, [grupoActivo]);

  // navbar sin breakpoint a propósito (sin versión móvil, es Electron/escritorio);
  // padding en el prop de AppShell, no en .content (pisaría el offset del navbar)
  return (
    <AppShell layout="alt" header={{ height: 56 }} navbar={{ width: colapsado ? 64 : 252 }} padding={24}>
      <AppShell.Header className="topbar">
        <BuscadorGlobal />
        <div className="topbar-right">
          <ThemeSwitcher />
          <NotificationBell />
          <BotStatusWidget />
          <div className="avatar-chip" title={`${user?.username} · ${etiquetaRol(user?.rol)}`}>{iniciales}</div>
        </div>
      </AppShell.Header>

      <AppShell.Navbar className={`sidebar${colapsado ? ' colapsado' : ''}`} ref={navRef}>
        <div className="sidebar-top">
          <button className="brand-mono" title={colapsado ? 'Expandir menú' : 'Contraer menú'} onClick={() => setColapsado(v => !v)}>
            {monograma}
          </button>
          {!colapsado && <div className="sidebar-brand">{nombreNegocio}</div>}
        </div>
        <nav className="sidebar-nav">
          {colapsado ? (
            grupos.map(g => {
              const IconoCat = ICONO_CATEGORIA[g.titulo] || Home;
              const catActiva = g.enlaces.some(e => e.to === location.pathname);
              return (
                <div className="rail-cat" key={g.titulo}>
                  <button
                    title={g.titulo}
                    className={`sidebar-link solo-icono${catActiva ? ' active' : ''}${flyout === g.titulo ? ' abierta' : ''}`}
                    onClick={() => setFlyout(f => (f === g.titulo ? null : g.titulo))}
                  >
                    <IconoCat size={18} strokeWidth={1.75} />
                  </button>
                  {flyout === g.titulo && (
                    <div className="rail-sub">
                      {g.enlaces.map(e => (
                        <NavLink key={e.to} to={e.to} end={e.to === '/'} title={e.label} onClick={() => setFlyout(null)}
                          className={({ isActive }) => `sidebar-link solo-icono sub${isActive ? ' active' : ''}`}>
                          <e.Icono size={15} strokeWidth={1.75} />
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
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
              <span className="sidebar-user-rol">{etiquetaRol(user?.rol)}</span>
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
