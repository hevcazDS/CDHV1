import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users, Package, Tag, CornerDownLeft } from 'lucide-react';
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

  const hay = (res && (res.clientes?.length || res.pedidos?.length || res.productos?.length)) || destinos.length;

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
          {res?.clientes?.length > 0 && <div className="buscador-seccion"><Users size={12} /> Clientes</div>}
          {res?.clientes?.map(c => (
            <button key={'c' + c.id} className="buscador-item" onClick={() => ir('/clientes')}>
              <strong>{c.nombre || 'Sin nombre'}</strong><span>{soloTelefono(c.telefono)}</span>
            </button>
          ))}
          {res?.pedidos?.length > 0 && <div className="buscador-seccion"><Package size={12} /> Pedidos</div>}
          {res?.pedidos?.map(pd => (
            <button key={'p' + pd.id_pedido} className="buscador-item" onClick={() => ir('/pedidos')}>
              <strong>{pd.folio}</strong><span>{pd.cliente || '-'} · {pd.estatus}{pd.total ? ' · $' + Number(pd.total).toFixed(2) : ''}</span>
            </button>
          ))}
          {res?.productos?.length > 0 && <div className="buscador-seccion"><Tag size={12} /> Productos</div>}
          {res?.productos?.map(pr => (
            <button key={'x' + pr.id} className="buscador-item" onClick={() => setAbierto(false)}>
              <strong>{pr.name}</strong><span>${Number(pr.price).toFixed(2)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
