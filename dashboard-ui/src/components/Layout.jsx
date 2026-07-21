import { useEffect, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AppShell, Accordion, Menu } from '@mantine/core';
import { confirmar } from '../lib/ui';
import { useAuth } from '../context/AuthContext';
import {
  Home, ReceiptText, Package, Undo2, MessagesSquare, MessageCircle,
  Truck, Send, BellRing, CalendarDays, Users, Trophy, Tag, Ticket,
  RefreshCw, Search, BarChart3, Tags, Settings, Star, FlaskConical,
  LogOut, Landmark, Warehouse, ShoppingCart, IdCard,
  UserCog, Utensils, Wallet, CalendarClock, ClipboardList, FileText, TrendingUp, Inbox, LogIn, Mail,
} from 'lucide-react';
import { api } from '../api';
import BotStatusWidget from './BotStatusWidget';
import InstanciaSwitcher from './InstanciaSwitcher';
import ThemeSwitcher from './ThemeSwitcher';
import NotificationBell from './NotificationBell';
import SoporteWidget from './SoporteWidget';
import BuscadorGlobal from './BuscadorGlobal';
import { tieneRango } from '../lib/roles';
import { permite, etiquetaRol, esAuditor } from '../lib/permisos';

// Orden de definición = orden visible, IGUAL para todos los roles. En una PyME
// el dueño ES quien atiende mostrador/pedidos, así que la OPERACIÓN va arriba y
// la gestión/configuración al fondo (antes se invertía para admin, y por eso el
// menú "se sentía revuelto"). El especialista ve solo su rebanada; el dueño ve
// la lista completa que empieza como la de un operador. Nombres de negocio, no
// técnicos. Poda por giro reusando módulos (ej. entrega_paqueteria_activo).
// Ola 2 (PROPUESTA_UI_ERP §C): 9 grupos por dominio de negocio. Marketing,
// Compras y Catálogo son páginas-módulo (sus antiguas páginas viven dentro
// como tabs; las rutas viejas redirigen en App.jsx).
const GRUPOS = [
  { titulo: 'Panel', enlaces: [
    { to: '/', label: 'Inicio', Icono: Home },
    { to: '/tareas', label: 'Tareas', Icono: ClipboardList },
    { to: '/mensajes', label: 'Mensajes', Icono: Inbox },
  ]},
  { titulo: 'Ventas', enlaces: [
    { to: '/mostrador', label: 'Mostrador', Icono: ReceiptText, moduloRequerido: 'pos_activo', area: 'pos' },
    { to: '/mesas', label: 'Mesas', Icono: Utensils, area: 'pos', moduloRequerido: 'mesas_activo' },
    { to: '/cocina', label: 'Cocina', Icono: Utensils, area: 'pos', moduloRequerido: 'mesas_activo' },
    { to: '/citas', label: 'Citas', Icono: CalendarClock, area: 'operacion', moduloRequerido: 'citas_activo' },
    { to: '/asistencias', label: 'Check-in', Icono: LogIn, area: 'operacion', moduloRequerido: 'citas_activo' },
    { to: '/ordenes-servicio', label: 'Órdenes de servicio', Icono: ClipboardList, area: 'operacion', moduloRequerido: 'citas_activo' },
    { to: '/suscripciones', label: 'Suscripciones', Icono: CalendarClock, area: 'operacion', moduloRequerido: 'suscripcion_activo' },
    { to: '/documentos', label: 'Documentos', Icono: FileText, area: 'operacion', moduloRequerido: 'documentos_activo' },
    { to: '/pedidos', area: 'operacion', label: 'Pedidos', Icono: Package },
    { to: '/devoluciones', area: 'operacion', label: 'Devoluciones', Icono: Undo2 },
    { to: '/fiados', label: 'Fiados', Icono: Wallet, areas: ['pos', 'finanzas'], moduloRequerido: 'ventas_credito_activo' },
  ]},
  { titulo: 'Envíos', enlaces: [
    { to: '/guias', label: 'Guías Estafeta', Icono: Truck, rolRequerido: 'gerente', moduloRequerido: 'entrega_paqueteria_activo' },
    { to: '/cola-envios', label: 'Cola de envíos', Icono: Send, rolRequerido: 'gerente', moduloRequerido: 'entrega_paqueteria_activo' },
  ]},
  { titulo: 'Clientes y bot', enlaces: [
    { to: '/cola', area: 'operacion', label: 'Cola de atención', Icono: MessagesSquare },
    { to: '/notificaciones', area: 'operacion', label: 'Chat y mensajes', Icono: MessageCircle },
    { to: '/clientes', area: 'operacion', label: 'Clientes', Icono: Users },
    { to: '/crm', area: 'operacion', label: 'CRM · Pipeline', Icono: TrendingUp },
    { to: '/ranking', area: 'operacion', label: 'Ranking', Icono: Trophy },
    { to: '/marketing', label: 'Marketing', Icono: Tag, rolRequerido: 'gerente' },
    { to: '/correo', label: 'Correo', Icono: Mail, rolRequerido: 'gerente', moduloRequerido: 'correo_activo' },
  ]},
  { titulo: 'Catálogo', enlaces: [
    { to: '/catalogo', label: 'Productos', Icono: Tags, rolRequerido: 'gerente' },
  ]},
  { titulo: 'Almacén', enlaces: [
    { to: '/almacen', label: 'Almacén', Icono: Warehouse, areas: ['almacen', 'almacen_lectura'] },
  ]},
  { titulo: 'Compras y finanzas', enlaces: [
    { to: '/compras', label: 'Compras', Icono: ShoppingCart, areas: ['compras', 'finanzas'] },
    { to: '/erp', label: 'Finanzas', Icono: Landmark, area: 'finanzas' },
    { to: '/metricas', label: 'Métricas', Icono: BarChart3, rolRequerido: 'gerente' },
    { to: '/busquedas', label: 'Búsquedas', Icono: Search, rolRequerido: 'gerente' },
  ]},
  { titulo: 'Personal', enlaces: [
    { to: '/rrhh', label: 'Recursos Humanos', Icono: IdCard, area: 'rrhh', moduloRequerido: 'rrhh_activo' },
  ]},
  { titulo: 'Ajustes', enlaces: [
    { to: '/prime?tab=usuarios', label: 'Usuarios', Icono: UserCog, rolRequerido: 'gerente' },
    { to: '/modulos', label: 'Módulos', Icono: Settings, rolRequerido: 'gerente' },
    { to: '/prime', label: 'Configuración', Icono: Star, rolRequerido: 'gerente' },
    { to: '/beta', label: 'Beta / Pruebas', Icono: FlaskConical, rolRequerido: 'prime' },
  ]},
];

// Regleta de módulo (SPEC_MOTION_UI §D): el data-modulo en el AppShell tiñe
// el borde superior del contenido y el link activo del sidebar con el color
// del dominio — orientación instantánea sin tocar ninguna página.
const MODULO_DE_GRUPO = {
  'Panel': 'panel', 'Ventas': 'ventas', 'Envíos': 'envios',
  'Clientes y bot': 'clientes', 'Catálogo': 'catalogo', 'Almacén': 'almacen',
  'Compras y finanzas': 'finanzas', 'Personal': 'personal', 'Ajustes': 'ajustes',
};

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
  // Módulos que gobiernan links del sidebar: UNA sola query batch (antes eran 6
  // requests sueltos a /api/modulo/:clave y los grupos iban APARECIENDO conforme
  // respondían → el sidebar "brincaba" al cargar). El último snapshot vive en
  // localStorage como initialData: en recargas el menú sale completo al instante
  // y solo se corrige si algo cambió de verdad.
  const CLAVES_SIDEBAR = 'pos_activo,rrhh_activo,mesas_activo,citas_activo,suscripcion_activo,documentos_activo,ventas_credito_activo,entrega_paqueteria_activo,correo_activo';
  const { data: modulosActivos = {} } = useQuery({
    queryKey: ['modulos-sidebar'],
    queryFn: () => api.get('/api/modulos?claves=' + CLAVES_SIDEBAR).then(m => {
      try { localStorage.setItem('modulos-sidebar', JSON.stringify(m)); } catch (_) {}
      return m;
    }).catch(() => ({ entrega_paqueteria_activo: true })),
    initialData: () => {
      try { return JSON.parse(localStorage.getItem('modulos-sidebar') || '') || undefined; } catch (_) { return undefined; }
    },
  });
  // rolRequerido es rango mínimo, no match exacto
  const grupos = GRUPOS
    .map(g => ({ ...g, enlaces: g.enlaces.filter(e => {
      // Auditor: lee todo excepto configuración (Módulos/Prime/Beta)
      const pasaRol = e.rolRequerido
        ? (tieneRango(user?.rol, e.rolRequerido) ||
           (esAuditor(user?.rol) && e.rolRequerido === 'gerente' && !['/prime', '/modulos'].includes(e.to.split('?')[0])))
        : true;
      return pasaRol &&
        (!e.area || permite(user?.rol, e.area)) &&
        (!e.areas || e.areas.some(a => permite(user?.rol, a))) &&
        (!e.moduloRequerido || modulosActivos[e.moduloRequerido] ||
          // rh/contabilidad SIEMPRE ven su link de RRHH; la página avisa si el módulo está apagado
          (e.moduloRequerido === 'rrhh_activo' && ['rh', 'contabilidad'].includes(user?.rol)));
    }) }))
    .filter(g => g.enlaces.length > 0);

  // Marca del negocio: arranca del último nombre visto (localStorage), NUNCA de
  // un nombre hardcodeado — un clon white-label flasheaba "Julio Cepeda" en cada
  // carga. Con '' el hueco de la marca simplemente queda vacío ese primer render.
  const [nombreNegocio, setNombreNegocio] = useState(() => {
    try { return localStorage.getItem('nombre-negocio') || ''; } catch (_) { return ''; }
  });
  useEffect(() => {
    api.get('/api/negocio').then(d => {
      if (d?.nombre_negocio) {
        setNombreNegocio(d.nombre_negocio);
        try { localStorage.setItem('nombre-negocio', d.nombre_negocio); } catch (_) {}
      }
      // Tema de instancia: 'f' (rediseño, default) | 'clasico' (reversión).
      // Se cachea para que el primer render de la próxima carga ya salga bien.
      const tema = d?.tema_ui === 'clasico' ? 'clasico' : 'f';
      document.documentElement.setAttribute('data-tema-ui', tema);
      try { localStorage.setItem('tema-ui', tema); } catch (_) {}
      if (d?.giro) { try { localStorage.setItem('giro', d.giro); } catch (_) {} }
    }).catch(() => {});
  }, []);

  const iniciales = (user?.username || '?').slice(0, 2).toUpperCase();

  // Badges de pendientes en el sidebar (patrón Ynex — SPEC_CONVERGENCIA §D):
  // un contador junto al link cuando hay trabajo esperando. Refresca cada 45s.
  const { data: stats } = useQuery({
    queryKey: ['stats'], queryFn: () => api.get('/api/stats').catch(() => null),
    refetchInterval: 45000,
  });
  // No-leídos de la mensajería interna del equipo (insignia en el link Mensajes).
  const { data: msgNoLeidos } = useQuery({
    queryKey: ['mensajeria-no-leidos'], queryFn: () => api.get('/api/mensajeria/no-leidos').catch(() => null),
    refetchInterval: 30000,
  });
  const badgePorRuta = {
    '/cola': stats?.cola_atencion || 0,
    '/pedidos': stats?.pagos_pendientes || 0,
    '/mensajes': msgNoLeidos?.total || 0,
  };

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
  // Web responsivo: en ventana angosta de navegador (< 1000px) el sidebar se
  // colapsa solo a riel de iconos para no comerse el ancho del contenido. No
  // vuelve a expandir solo al ensanchar (respeta la elección del usuario).
  useEffect(() => {
    const alAncho = () => { if (window.innerWidth < 1000) setColapsado(true); };
    alAncho();
    window.addEventListener('resize', alAncho);
    return () => window.removeEventListener('resize', alAncho);
  }, []);
  // Monograma del negocio ("Julio Cepeda Jugueterías" → JC): es el botón
  // de contraer/extraer
  const monograma = nombreNegocio.split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
  // Iconos del riel colapsado: DEBEN coincidir con los títulos reales de GRUPOS
  // (Panel/Ventas/Envíos/Clientes y bot/Catálogo/Almacén/Compras y finanzas/
  // Personal/Ajustes). Antes tenían claves viejas ('Mostrador'/'Configuración'…)
  // que no matcheaban → todos caían al fallback Home y se veían duplicados.
  const ICONO_CATEGORIA = {
    'Panel': Home, 'Ventas': ReceiptText, 'Envíos': Truck, 'Clientes y bot': Users,
    'Catálogo': Tags, 'Almacén': Warehouse, 'Compras y finanzas': Landmark,
    'Personal': IdCard, 'Ajustes': Settings,
  };

  // Acordeón de un grupo abierto a la vez, siempre el de la ruta activa
  // (todos expandidos desbordaban el alto del sidebar en laptops)
  const grupoActivo = grupos.find(g => g.enlaces.some(e => e.to === location.pathname))?.titulo || grupos[0]?.titulo;
  const [abierto, setAbierto] = useState(grupoActivo);
  useEffect(() => { setAbierto(grupoActivo); }, [grupoActivo]);

  // El riel colapsado (64px) ya cubre el caso móvil (ver alAncho arriba);
  // padding en el prop de AppShell, no en .content (pisaría el offset del navbar)
  return (
    <AppShell layout="alt" header={{ height: 56 }} navbar={{ width: colapsado ? 64 : 252 }} padding={24}
      data-modulo={MODULO_DE_GRUPO[grupoActivo] || 'panel'}>
      <AppShell.Header className="topbar">
        <BuscadorGlobal />
        <div className="topbar-right">
          {/* Selector de tienda (una BD por tienda) — solo Prime y solo con 2+ instancias */}
          <InstanciaSwitcher />
          <ThemeSwitcher />
          <NotificationBell />
          {/* El bot es un módulo (no la base): solo operación/gerente lo ven y controlan */}
          {permite(user?.rol, 'operacion') && <BotStatusWidget />}
          {/* Identidad ÚNICA del usuario (arriba, estándar): avatar → menú con
              nombre/rol y "Cerrar sesión" CON confirmación (evita el click
              accidental). El pie del sidebar ya no duplica al usuario (tema F). */}
          <Menu position="bottom-end" width={220} shadow="md">
            <Menu.Target>
              <button className="avatar-chip" title={`${user?.username} · ${etiquetaRol(user?.rol)}${user?.version ? ' · v' + user.version : ''}`} style={{ cursor: 'pointer' }}>{iniciales}</button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>{user?.username} · {etiquetaRol(user?.rol)}</Menu.Label>
              <Menu.Divider />
              <Menu.Item color="red" leftSection={<LogOut size={14} />} onClick={async () => {
                if (await confirmar({ titulo: 'Cerrar sesión', mensaje: '¿Cerrar tu sesión en el panel?', textoOk: 'Cerrar sesión' })) logout();
              }}>Cerrar sesión</Menu.Item>
            </Menu.Dropdown>
          </Menu>
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
                  <Accordion.Control>
                    {g.titulo}
                    {(() => { const n = g.enlaces.reduce((s, e) => s + (badgePorRuta[e.to] || 0), 0); return n > 0 ? <span className="nav-badge" style={{ marginLeft: 8 }}>{n}</span> : null; })()}
                  </Accordion.Control>
                  <Accordion.Panel>
                    {g.enlaces.map(e => (
                      <NavLink key={e.to} to={e.to} className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`} end={e.to === '/'}>
                        <e.Icono size={16} strokeWidth={1.75} />{e.label}
                        {badgePorRuta[e.to] > 0 && <span className="nav-badge">{badgePorRuta[e.to]}</span>}
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
        {/* key por ruta re-dispara la animación de entrada (tema F, 180ms) */}
        <div key={location.pathname} className="page-anim">
          <Outlet />
        </div>
      </AppShell.Main>
      <SoporteWidget />
    </AppShell>
  );
}
