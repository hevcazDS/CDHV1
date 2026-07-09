import { useState } from 'react';
import { Tabs } from '@mantine/core';
import ProveedoresTab from './erp/ProveedoresTab';
import ComprasTab from './erp/ComprasTab';
import CxpTab from './erp/CxpTab';
import ContabilidadTab from './erp/ContabilidadTab';
import GastosImpuestosTab from './erp/GastosImpuestosTab';
import RastroTab from './erp/RastroTab';
import TableroTab from './erp/TableroTab';
import FacturacionTab from './erp/FacturacionTab';
import VentasProductoTab from './erp/VentasProductoTab';

const TABS = [
  { key: 'tablero', label: 'Tablero de dirección', Componente: TableroTab },
  { key: 'proveedores', label: 'Proveedores', Componente: ProveedoresTab },
  { key: 'compras', label: 'Órdenes de compra', Componente: ComprasTab },
  { key: 'cxp', label: 'Cuentas por pagar', Componente: CxpTab },
  { key: 'contabilidad', label: 'Contabilidad', Componente: ContabilidadTab },
  { key: 'gastos', label: 'Gastos e impuestos', Componente: GastosImpuestosTab },
  { key: 'ventas-prod', label: 'Ventas por producto', Componente: VentasProductoTab },
  { key: 'facturacion', label: 'Facturación pendiente', Componente: FacturacionTab },
  { key: 'rastro', label: 'Rastro de documento', Componente: RastroTab },
];

export default function Erp() {
  const [tab, setTab] = useState('proveedores');
  const Activo = TABS.find(t => t.key === tab)?.Componente;
  return (
    <div>
      <div className="page-title">ERP · Finanzas</div>
      <div className="page-sub">Proveedores, compras, cuentas por pagar y libro mayor</div>
      <Tabs value={tab} onChange={setTab} mb="md">
        <Tabs.List>
          {TABS.map(t => <Tabs.Tab key={t.key} value={t.key}>{t.label}</Tabs.Tab>)}
        </Tabs.List>
      </Tabs>
      {Activo && <Activo />}
    </div>
  );
}
