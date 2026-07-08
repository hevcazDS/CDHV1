import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, Button, Text } from '@mantine/core';
import { Warehouse, PackageOpen, MapPinOff, ShoppingCart, ClipboardList, FileText, IdCard, Users, BadgeDollarSign } from 'lucide-react';
import { api } from '../../api';
import { fmtMoneda, Kpi } from './comunes';

// Vistas de inicio para almacén / compras / rh: 2-3 números de SU chamba
// y el botón directo a su módulo. Nada de métricas ajenas.

export function VistaAlmacen() {
  const { data: inv = [] } = useQuery({ queryKey: ['almacen-inv', ''], queryFn: () => api.get('/api/almacen/inventario?q=').catch(() => []) });
  const { data: ocs = [] } = useQuery({ queryKey: ['erp-ocs'], queryFn: () => api.get('/api/erp/ordenes-compra').catch(() => []) });
  const bajoMinimo = inv.filter(x => x.stock <= (x.stock_minimo || 0) && (x.stock_minimo || 0) > 0).length;
  const sinUbicar = inv.filter(x => !x.zona && !x.pasillo && !x.rack).length;
  const porRecibir = ocs.filter(o => o.estatus === 'abierta').length;
  return (
    <Tarjetas boton={{ to: '/almacen', label: 'Ir a Almacén', Icono: Warehouse }} items={[
      { Icono: PackageOpen, color: porRecibir > 0 ? 'var(--accent)' : 'var(--text-mute)', label: 'OC por recibir', valor: porRecibir },
      { Icono: Warehouse, color: bajoMinimo > 0 ? 'var(--red)' : 'var(--green)', label: 'Bajo stock mínimo', valor: bajoMinimo },
      { Icono: MapPinOff, color: 'var(--yellow)', label: 'Sin ubicación asignada', valor: sinUbicar },
    ]} />
  );
}

export function VistaCompras() {
  const { data: sol = [] } = useQuery({ queryKey: ['compras-sol'], queryFn: () => api.get('/api/compras/solicitudes').catch(() => []) });
  const { data: ocs = [] } = useQuery({ queryKey: ['erp-ocs'], queryFn: () => api.get('/api/erp/ordenes-compra').catch(() => []) });
  const { data: cxp = [] } = useQuery({ queryKey: ['erp-cxp'], queryFn: () => api.get('/api/erp/cxp').catch(() => []) });
  const pendientes = sol.filter(s => s.estatus === 'pendiente').length;
  const abiertas = ocs.filter(o => o.estatus === 'abierta').length;
  const porVencer7 = cxp.filter(x => x.estatus === 'pendiente' && x.dias_para_vencer <= 7).length;
  return (
    <Tarjetas boton={{ to: '/compras', label: 'Ir a Compras', Icono: ShoppingCart }} items={[
      { Icono: ClipboardList, color: 'var(--accent)', label: 'Solicitudes pendientes', valor: pendientes },
      { Icono: ShoppingCart, color: '#4aa8ff', label: 'OC abiertas', valor: abiertas },
      { Icono: FileText, color: porVencer7 > 0 ? 'var(--red)' : 'var(--text-mute)', label: 'CxP vencen en ≤7 días', valor: porVencer7 },
    ]} />
  );
}

export function VistaRh() {
  const { data: emp = [], error } = useQuery({ queryKey: ['rrhh-emp'], queryFn: () => api.get('/api/rrhh/empleados') });
  const { data: nom = [] } = useQuery({ queryKey: ['rrhh-nom'], queryFn: () => api.get('/api/rrhh/nomina').catch(() => []) });
  const sinPagar = Array.isArray(nom) ? nom.filter(n => n.estatus === 'calculada') : [];
  const montoSinPagar = sinPagar.reduce((s, n) => s + (n.neto || 0), 0);
  if (error || emp?.error) return <Text c="dimmed">El módulo RRHH está desactivado — pide al administrador activarlo en Módulos.</Text>;
  return (
    <Tarjetas boton={{ to: '/rrhh', label: 'Ir a Recursos Humanos', Icono: IdCard }} items={[
      { Icono: Users, color: 'var(--accent)', label: 'Empleados activos', valor: Array.isArray(emp) ? emp.length : 0 },
      { Icono: BadgeDollarSign, color: sinPagar.length > 0 ? 'var(--yellow)' : 'var(--green)', label: 'Nóminas por pagar', valor: sinPagar.length },
      { Icono: BadgeDollarSign, color: 'var(--text-mute)', label: 'Monto por pagar', valor: fmtMoneda(montoSinPagar) },
    ]} />
  );
}

function Tarjetas({ items, boton }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, maxWidth: 980 }}>
      {items.map((it, i) => (
        <Card key={i} withBorder radius="md" p="md" className="kpi-card kpi-sq">
          <Kpi Icono={it.Icono} color={it.color} label={it.label}>{it.valor}</Kpi>
        </Card>
      ))}
      <Card withBorder radius="md" p="md" className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Button size="md" component={Link} to={boton.to} leftSection={<boton.Icono size={17} strokeWidth={1.75} />}>{boton.label}</Button>
      </Card>
    </div>
  );
}
