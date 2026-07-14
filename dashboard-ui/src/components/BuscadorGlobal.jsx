import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users, Package, Tag, CornerDownLeft, Truck, FileText, Factory, IdCard } from 'lucide-react';
import { api } from '../api';
import { soloTelefono } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { permite, esAdminOMas } from '../lib/permisos';
import { tieneRango } from '../lib/roles';

// Buscador global del topbar + command palette (Ola 3, PROPUESTA_UI_ERP §B5):
// Ctrl+K enfoca; además de clientes/pedidos/productos, navega a cualquier
// sección del ERP escribiendo su nombre ("cuentas por pagar", "corte"...).
// Registro estático filtrado por rol — sin dependencias nuevas.
const DESTINOS = [
  { label: 'Inicio', to: '/' },
  { label: 'Tareas y recordatorios', to: '/tareas' },
  { label: 'Mostrador (POS) · cobrar', to: '/mostrador', area: 'pos' },
  { label: 'Corte de caja', to: '/mostrador', area: 'pos' },
  { label: 'Mesas', to: '/mesas', area: 'pos' },
  { label: 'Citas', to: '/citas', area: 'operacion' },
  { label: 'Pedidos', to: '/pedidos', area: 'operacion' },
  { label: 'Devoluciones', to: '/devoluciones', area: 'operacion' },
  { label: 'Fiados (crédito)', to: '/fiados', areas: ['pos', 'finanzas'] },
  { label: 'Cola de atención', to: '/cola', area: 'operacion' },
  { label: 'Chat y mensajes', to: '/notificaciones', area: 'operacion' },
  { label: 'Clientes', to: '/clientes', area: 'operacion' },
  { label: 'Marketing · Ofertas', to: '/marketing?tab=ofertas', rol: 'gerente' },
  { label: 'Marketing · Cupones', to: '/marketing?tab=cupones', rol: 'gerente' },
  { label: 'Marketing · Lista de espera', to: '/marketing?tab=lista-espera', rol: 'gerente' },
  { label: 'Catálogo · Productos (alta)', to: '/catalogo?tab=productos', rol: 'gerente' },
  { label: 'Catálogo · Etiquetas', to: '/catalogo?tab=etiquetas', rol: 'gerente' },
  { label: 'Almacén · Inventario', to: '/almacen', areas: ['almacen', 'almacen_lectura'] },
  { label: 'Compras · Órdenes de compra', to: '/compras?tab=ordenes', areas: ['compras', 'finanzas'] },
  { label: 'Compras · Cuentas por pagar', to: '/compras?tab=cxp', areas: ['compras', 'finanzas'] },
  { label: 'Compras · Proveedores', to: '/compras?tab=proveedores', areas: ['compras', 'finanzas'] },
  { label: 'Finanzas · Tablero de dirección', to: '/erp?tab=tablero', area: 'finanzas' },
  { label: 'Finanzas · Flujo de caja', to: '/erp?tab=flujo-caja', area: 'finanzas' },
  { label: 'Finanzas · Contabilidad (pólizas)', to: '/erp?tab=contabilidad', area: 'finanzas' },
  { label: 'Finanzas · Gastos e impuestos', to: '/erp?tab=gastos', area: 'finanzas' },
  { label: 'Finanzas · Ventas por producto', to: '/erp?tab=ventas-prod', area: 'finanzas' },
  { label: 'Métricas', to: '/metricas', rol: 'gerente' },
  { label: 'Recursos Humanos · Nómina', to: '/rrhh', area: 'rrhh' },
  { label: 'Usuarios y roles', to: '/prime?tab=usuarios', rol: 'gerente' },
  { label: 'Módulos (activar funciones)', to: '/modulos', rol: 'gerente' },
  { label: 'Configuración del negocio', to: '/prime', rol: 'gerente' },
];

const _norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Categor\u00edas de resultados (el SERVIDOR ya filtr\u00f3 por rol \u2014 aqu\u00ed solo se pinta
// lo que lleg\u00f3). `linea` arma t\u00edtulo/detalle; `to` decide a d\u00f3nde navega.
const CATEGORIAS = {
  clientes:    { titulo: 'Clientes',    Icono: Users,    to: () => '/clientes', linea: c => [c.nombre || 'Sin nombre', soloTelefono(c.telefono)] },
  pedidos:     { titulo: 'Pedidos',     Icono: Package,  to: () => '/pedidos', linea: p => [p.folio, `${p.cliente || '-'} \u00b7 ${p.estatus}${p.total ? ' \u00b7 $' + Number(p.total).toFixed(2) : ''}`] },
  productos:   { titulo: 'Productos',   Icono: Tag,      to: null, linea: p => [p.name, '$' + Number(p.price).toFixed(2)] },
  guias:       { titulo: 'Gu\u00edas',       Icono: Truck,    to: () => '/guias', linea: g => [g.numero_guia, `${g.dest_nombre || '-'} \u00b7 ${g.estatus || ''}`] },
  documentos:  { titulo: 'Documentos',  Icono: FileText, to: () => '/documentos', linea: d => [d.contraparte_nombre || d.tipo, `${d.tipo}${d.monto ? ' \u00b7 $' + Number(d.monto).toFixed(2) : ''}`] },
  proveedores: { titulo: 'Proveedores', Icono: Factory,  to: () => '/compras?tab=proveedores', linea: p => [p.nombre, p.rfc || ''] },
  empleados:   { titulo: 'Empleados',   Icono: IdCard,   to: () => '/rrhh', linea: e => [e.nombre, e.puesto || ''] },
};

// Ranking por rol: el MISMO query ordena distinto seg\u00fan qui\u00e9n busca \u2014 el
// cajero ve productos primero; cobranza ve folios/documentos; RH su gente.
const ORDEN_DEFAULT = ['clientes', 'pedidos', 'productos', 'guias', 'documentos', 'proveedores', 'empleados'];
const ORDEN_POR_ROL = {
  cajero:       ['productos', 'clientes', 'pedidos', 'guias'],
  almacen:      ['productos'],
  compras:      ['productos', 'proveedores'],
  contabilidad: ['pedidos', 'documentos', 'proveedores', 'clientes'],
  rh:           ['empleados'],
};

export default function BuscadorGlobal() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [abierto, setAbierto] = useState(false);
  const ref = useRef(null);
  const inputRef = useRef(null);
  const timer = useRef(null);

  // Ctrl+K / Cmd+K → enfocar el buscador desde cualquier página
  useEffect(() => {
    function atajo(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    document.addEventListener('keydown', atajo);
    return () => document.removeEventListener('keydown', atajo);
  }, []);

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setRes(null); setAbierto(q.trim().length >= 2); return; }
    setAbierto(true);
    timer.current = setTimeout(() => {
      api.get('/api/buscar?q=' + encodeURIComponent(q.trim()))
        .then(r => { setRes(r); setAbierto(true); })
        .catch(() => setRes(null));
    }, 300);
    return () => clearTimeout(timer.current);
  }, [q]);

  useEffect(() => {
    function fuera(e) { if (ref.current && !ref.current.contains(e.target)) setAbierto(false); }
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, []);

  const ir = (ruta) => { setAbierto(false); setQ(''); navigate(ruta); };

  const pasaGate = (d) =>
    (!d.rol || tieneRango(user?.rol, d.rol) || esAdminOMas(user?.rol)) &&
    (!d.area || permite(user?.rol, d.area)) &&
    (!d.areas || d.areas.some(a => permite(user?.rol, a)));
  const nq = _norm(q.trim());
  const destinos = nq.length >= 2
    ? DESTINOS.filter(d => pasaGate(d) && _norm(d.label).includes(nq)).slice(0, 6)
    : [];

  // Orden de categorías según el rol (ranking); solo las que traen resultados.
  const orden = ORDEN_POR_ROL[user?.rol] || ORDEN_DEFAULT;
  const cats = orden.filter(k => res?.[k]?.length > 0);
  const hay = cats.length > 0 || destinos.length > 0;

  return (
    <div className="buscador" ref={ref}>
      <Search size={15} strokeWidth={1.75} className="buscador-icono" />
      <input
        ref={inputRef}
        className="buscador-input"
        placeholder="Buscar o ir a una sección…  (Ctrl+K)"
        value={q}
        onChange={e => setQ(e.target.value)}
        onFocus={() => (res || destinos.length) && setAbierto(true)}
        onKeyDown={e => { if (e.key === 'Enter' && destinos.length) ir(destinos[0].to); if (e.key === 'Escape') { setAbierto(false); e.currentTarget.blur(); } }}
      />
      {abierto && (res || destinos.length > 0) && (
        <div className="buscador-drop">
          {!hay && <div className="buscador-vacio">Sin resultados para “{q}”</div>}
          {destinos.length > 0 && <div className="buscador-seccion"><CornerDownLeft size={12} /> Ir a</div>}
          {destinos.map(d => (
            <button key={d.to + d.label} className="buscador-item" onClick={() => ir(d.to)}>
              <strong>{d.label}</strong><span>{d.to.split('?')[0]}</span>
            </button>
          ))}
          {cats.map(k => {
            const cat = CATEGORIAS[k];
            return (
              <div key={k}>
                <div className="buscador-seccion"><cat.Icono size={12} /> {cat.titulo}</div>
                {res[k].map((item, i) => {
                  const [titulo, detalle] = cat.linea(item);
                  return (
                    <button key={k + (item.id ?? item.id_pedido ?? item.numero_guia ?? i)} className="buscador-item"
                      onClick={() => (cat.to ? ir(cat.to(item)) : setAbierto(false))}>
                      <strong>{titulo}</strong><span>{detalle}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
