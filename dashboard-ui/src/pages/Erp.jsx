import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs } from '@mantine/core';
import { useAuth } from '../context/AuthContext';
import { permite } from '../lib/permisos';
import ProveedoresTab from './erp/ProveedoresTab';
import ComprasTab from './erp/ComprasTab';
import CxpTab from './erp/CxpTab';
import ContabilidadTab from './erp/ContabilidadTab';
import GastosImpuestosTab from './erp/GastosImpuestosTab';
import RastroTab from './erp/RastroTab';
import TableroTab from './erp/TableroTab';
import FacturacionTab from './erp/FacturacionTab';
import VentasProductoTab from './erp/VentasProductoTab';
import RentabilidadClientesTab from './erp/RentabilidadClientesTab';
import RentabilidadVendedoresTab from './erp/RentabilidadVendedoresTab';
import FlujoCajaTab from './erp/FlujoCajaTab';

// Cada tab declara sus áreas (espejo de los gates reales de dashboard/routes/
// erpProveedores.js y erpContabilidad.js): el rol `compras` solo ve Proveedores/
// OC/CxP — antes veía los 12 tabs y los de finanzas le respondían 403.
const TABS = [
  { key: 'tablero', label: 'Tablero de dirección', Componente: TableroTab, areas: ['finanzas'] },
  { key: 'flujo-caja', label: 'Flujo de caja', Componente: FlujoCajaTab, areas: ['finanzas'] },
  { key: 'proveedores', label: 'Proveedores', Componente: ProveedoresTab, areas: ['compras', 'finanzas'] },
  { key: 'compras', label: 'Órdenes de compra', Componente: ComprasTab, areas: ['compras', 'finanzas'] },
  { key: 'cxp', label: 'Cuentas por pagar', Componente: CxpTab, areas: ['compras', 'finanzas'] },
  { key: 'contabilidad', label: 'Contabilidad', Componente: ContabilidadTab, areas: ['finanzas'] },
  { key: 'gastos', label: 'Gastos e impuestos', Componente: GastosImpuestosTab, areas: ['finanzas'] },
  { key: 'ventas-prod', label: 'Ventas por producto', Componente: VentasProductoTab, areas: ['finanzas'] },
  { key: 'rent-clientes', label: 'Rentabilidad por cliente', Componente: RentabilidadClientesTab, areas: ['finanzas'] },
  { key: 'rent-vend', label: 'Rentabilidad por vendedor', Componente: RentabilidadVendedoresTab, areas: ['finanzas'] },
  { key: 'facturacion', label: 'Facturación pendiente', Componente: FacturacionTab, areas: ['finanzas'] },
  { key: 'rastro', label: 'Rastro de documento', Componente: RastroTab, areas: ['finanzas'] },
];

export default function Erp() {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const visibles = TABS.filter(t => t.areas.some(a => permite(user?.rol, a)));
  // Tab deep-linkeable (/erp?tab=cxp — se puede mandar el link a un empleado);
  // sin ?tab= cae al último abierto (localStorage) y luego al primero visible.
  const [tab, setTab] = useState(() => {
    const deUrl = sp.get('tab');
    if (visibles.some(x => x.key === deUrl)) return deUrl;
    const t = (typeof localStorage !== 'undefined') && localStorage.getItem('erp-tab');
    return visibles.some(x => x.key === t) ? t : (visibles[0]?.key || 'proveedores');
  });
  const cambiar = (t) => {
    setTab(t);
    setSp({ tab: t }, { replace: true });
    try { localStorage.setItem('erp-tab', t); } catch (_) {}
  };
  const activoDef = visibles.find(t => t.key === tab);
  const Activo = activoDef?.Componente;
  return (
    <div>
      <div className="page-title">Finanzas{activoDef ? ' · ' + activoDef.label : ''}</div>
      <div className="page-sub">Proveedores, compras, cuentas por pagar y libro mayor</div>
      <Tabs value={tab} onChange={cambiar} mb="md">
        <Tabs.List>
          {visibles.map(t => <Tabs.Tab key={t.key} value={t.key}>{t.label}</Tabs.Tab>)}
        </Tabs.List>
      </Tabs>
      {Activo && <Activo />}
    </div>
  );
}
