// ComprasModulo — el ciclo compra-a-pago completo en UNA página (Ola 2 de
// PROPUESTA_UI_ERP §C): solicitudes → OC → recepción/facturas → CxP →
// proveedores. Antes vivía partido entre /compras y 3 tabs de Finanzas
// (la propia página traía un letrero explicando dónde estaba su otra mitad).
// Los componentes de negocio NO se tocaron: solo cambiaron de contenedor.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs } from '@mantine/core';
import SolicitudesFacturas from './Compras';
import OrdenesCompraTab from './erp/ComprasTab';
import CxpTab from './erp/CxpTab';
import ProveedoresTab from './erp/ProveedoresTab';
import ResumenComprasTab from './compras/ResumenComprasTab';

const TABS = [
  { key: 'resumen', label: 'Resumen', Componente: ResumenComprasTab },
  { key: 'ordenes', label: 'Órdenes de compra', Componente: OrdenesCompraTab },
  { key: 'solicitudes', label: 'Solicitudes y facturas', Componente: SolicitudesFacturas },
  { key: 'cxp', label: 'Cuentas por pagar', Componente: CxpTab },
  { key: 'proveedores', label: 'Proveedores', Componente: ProveedoresTab },
];

export default function ComprasModulo() {
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState(() => TABS.some(t => t.key === sp.get('tab')) ? sp.get('tab') : 'resumen');
  const cambiar = (t) => { setTab(t); setSp({ tab: t }, { replace: true }); };
  const activo = TABS.find(t => t.key === tab);
  const Activo = activo?.Componente;
  return (
    <div>
      <div className="page-title">Compras · {activo?.label}</div>
      <div className="page-sub">Solicitudes, órdenes, recepción, facturas y pagos a proveedor — el ciclo completo</div>
      <Tabs value={tab} onChange={cambiar} mb="md">
        <Tabs.List>{TABS.map(t => <Tabs.Tab key={t.key} value={t.key}>{t.label}</Tabs.Tab>)}</Tabs.List>
      </Tabs>
      <div className="modulo-embebido">{Activo && <Activo irA={cambiar} />}</div>
    </div>
  );
}
