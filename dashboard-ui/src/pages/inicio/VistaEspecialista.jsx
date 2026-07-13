import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, Button, Text } from '@mantine/core';
import { Warehouse, PackageOpen, MapPinOff, ShoppingCart, ClipboardList, FileText, IdCard, Users, BadgeDollarSign } from 'lucide-react';
import { api } from '../../api';
import { fmtMoneda, Kpi } from './comunes';

// Inicios de almacén / compras / rh: sus números + LAS TABLAS de su chamba
// llenando la pantalla (misma fila-2col que las demás vistas, sin huecos).

export function VistaAlmacen() {
  const { data: inv = [] } = useQuery({ queryKey: ['almacen-inv', ''], queryFn: () => api.get('/api/almacen/inventario?q=').catch(() => []) });
  const { data: ocs = [] } = useQuery({ queryKey: ['erp-ocs'], queryFn: () => api.get('/api/erp/ordenes-compra').catch(() => []) });
  const bajos = inv.filter(x => x.stock <= (x.stock_minimo || 0) && (x.stock_minimo || 0) > 0);
  const sinUbicar = inv.filter(x => !x.zona && !x.pasillo && !x.rack).length;
  const ocsAbiertas = (Array.isArray(ocs) ? ocs : []).filter(o => o.estatus === 'abierta');
  return (
    <Plantilla
      boton={{ to: '/almacen', label: 'Ir a Almacén', Icono: Warehouse }}
      items={[
        { Icono: PackageOpen, color: ocsAbiertas.length > 0 ? 'var(--accent)' : 'var(--text-mute)', label: 'OC por recibir', valor: ocsAbiertas.length },
        { Icono: Warehouse, color: bajos.length > 0 ? 'var(--red)' : 'var(--green)', label: 'Bajo stock mínimo', valor: bajos.length },
        { Icono: MapPinOff, color: 'var(--yellow)', label: 'Sin ubicación', valor: sinUbicar },
      ]}
      tabla={{
        titulo: 'Productos bajo stock mínimo', head: ['Producto', 'Sucursal', 'Stock', 'Mínimo'],
        filas: bajos.slice(0, 9).map((x, i) => [
          <strong key={i}>{x.name}</strong>, x.sucursal,
          <span key={'s' + i} style={{ color: 'var(--red)', fontWeight: 700 }}>{x.stock}</span>, x.stock_minimo,
        ]),
        vacio: 'Nada bajo mínimo — inventario sano',
      }}
      tabla2={{
        titulo: 'OC por recibir', head: ['Folio', 'Proveedor', 'Total'],
        filas: ocsAbiertas.slice(0, 9).map((o, i) => [<strong key={i}>{o.folio}</strong>, o.proveedor, fmtMoneda(o.total)]),
        vacio: 'Sin órdenes pendientes de recibir',
      }}
    />
  );
}

export function VistaCompras() {
  const { data: sol = [] } = useQuery({ queryKey: ['compras-sol'], queryFn: () => api.get('/api/compras/solicitudes').catch(() => []) });
  const { data: ocs = [] } = useQuery({ queryKey: ['erp-ocs'], queryFn: () => api.get('/api/erp/ordenes-compra').catch(() => []) });
  const { data: cxp = [] } = useQuery({ queryKey: ['erp-cxp'], queryFn: () => api.get('/api/erp/cxp').catch(() => []) });
  const pend = sol.filter(s => s.estatus === 'pendiente');
  const abiertas = (Array.isArray(ocs) ? ocs : []).filter(o => o.estatus === 'abierta');
  const porVencer = cxp.filter(x => x.estatus === 'pendiente' && x.dias_para_vencer <= 7);
  return (
    <Plantilla
      boton={{ to: '/compras', label: 'Ir a Compras', Icono: ShoppingCart }}
      items={[
        { Icono: ClipboardList, color: 'var(--accent)', label: 'Solicitudes pendientes', valor: pend.length },
        { Icono: ShoppingCart, color: '#4aa8ff', label: 'OC abiertas', valor: abiertas.length },
        { Icono: FileText, color: porVencer.length > 0 ? 'var(--red)' : 'var(--text-mute)', label: 'CxP vencen en 7 días', valor: porVencer.length },
      ]}
      tabla={{
        titulo: 'Mis solicitudes recientes', head: ['Solicitud', 'Cant.', 'Estatus'],
        filas: sol.slice(0, 9).map((s, i) => [
          <strong key={i}>{s.descripcion}</strong>, s.cantidad || '-',
          <span key={'b' + i} className={`badge ${s.estatus === 'aprobada' ? 'badge-verde' : s.estatus === 'rechazada' ? 'badge-rojo' : 'badge-amarillo'}`}>{s.estatus}</span>,
        ]),
        vacio: 'Sin solicitudes — crea la primera en Compras',
      }}
      tabla2={{
        titulo: 'CxP próximas a vencer', head: ['Proveedor', 'Monto', 'Vence'],
        filas: porVencer.slice(0, 9).map((x, i) => [<strong key={i}>{x.proveedor}</strong>, fmtMoneda(x.monto), x.vence_en]),
        vacio: 'Nada por vencer esta semana',
      }}
    />
  );
}

export function VistaRh() {
  const { data: emp = [], error } = useQuery({ queryKey: ['rrhh-emp'], queryFn: () => api.get('/api/rrhh/empleados') });
  const { data: nom = [] } = useQuery({ queryKey: ['rrhh-nom'], queryFn: () => api.get('/api/rrhh/nomina').catch(() => []) });
  const noms = Array.isArray(nom) ? nom : [];
  const sinPagar = noms.filter(n => n.estatus === 'calculada');
  if (error || emp?.error) {
    return <Text c="dimmed">El módulo RRHH está desactivado — pide al administrador activarlo en Módulos.</Text>;
  }
  return (
    <Plantilla
      boton={{ to: '/rrhh', label: 'Ir a Recursos Humanos', Icono: IdCard }}
      items={[
        { Icono: Users, color: 'var(--accent)', label: 'Empleados activos', valor: Array.isArray(emp) ? emp.length : 0 },
        { Icono: BadgeDollarSign, color: sinPagar.length > 0 ? 'var(--yellow)' : 'var(--green)', label: 'Nóminas por pagar', valor: sinPagar.length },
        { Icono: BadgeDollarSign, color: 'var(--text-mute)', label: 'Monto por pagar', valor: fmtMoneda(sinPagar.reduce((s, n) => s + (n.neto || 0), 0)) },
      ]}
      tabla={{
        titulo: 'Últimas nóminas', head: ['Empleado', 'Periodo', 'Neto', 'Estatus'],
        filas: noms.slice(0, 9).map((n, i) => [
          <strong key={i}>{n.nombre}</strong>,
          <span key={'p' + i} className="text-muted" style={{ fontSize: 11 }}>{n.desde} a {n.hasta}</span>,
          fmtMoneda(n.neto),
          <span key={'e' + i} className={`badge ${n.estatus === 'pagada' ? 'badge-verde' : 'badge-amarillo'}`}>{n.estatus}</span>,
        ]),
        vacio: 'Sin nóminas — calcula el periodo en RRHH',
      }}
      tabla2={{
        titulo: 'Plantilla', head: ['Empleado', 'Puesto', 'Régimen'],
        filas: (Array.isArray(emp) ? emp : []).slice(0, 9).map((e, i) => [
          <strong key={i}>{e.nombre}</strong>, e.puesto || '-',
          <span key={'r' + i} className={`badge ${e.con_impuestos ? 'badge-azul' : 'badge-amarillo'}`}>{e.con_impuestos ? 'Con impuestos' : 'Sin impuestos'}</span>,
        ]),
        vacio: 'Sin empleados aún',
      }}
    />
  );
}

// Tarjetas arriba + dos tablas de trabajo llenando la fila (sin huecos)
function Plantilla({ items, boton, tabla, tabla2 }) {
  return (
    <div className="pagina-llena" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="kpi-grid">
        {items.map((it, i) => (
          <Card key={i} withBorder radius="md" p="md" className="kpi-card kpi-sq">
            <Kpi Icono={it.Icono} color={it.color} label={it.label}>{it.valor}</Kpi>
          </Card>
        ))}
        <Card withBorder radius="md" p="md" className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Button size="md" component={Link} to={boton.to} leftSection={<boton.Icono size={17} strokeWidth={1.75} />}>{boton.label}</Button>
        </Card>
      </div>
      <div className="fila-2col">
        {[tabla, tabla2].map((t, k) => (
          <Card key={k} withBorder radius="md" p="lg" className="card">
            <div className="card-header"><h3>{t.titulo}</h3></div>
            <div className="table-wrap tabla-compacta">
              <table>
                <thead><tr>{t.head.map(h => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {t.filas.length === 0 && <tr><td colSpan={t.head.length} className="empty">{t.vacio}</td></tr>}
                  {t.filas.map((f, i) => <tr key={i}>{f.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
