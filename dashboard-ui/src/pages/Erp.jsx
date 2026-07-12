import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ContabilidadTab from './erp/ContabilidadTab';
import GastosImpuestosTab from './erp/GastosImpuestosTab';
import RastroTab from './erp/RastroTab';
import TableroTab from './erp/TableroTab';
import FacturacionTab from './erp/FacturacionTab';
import VentasProductoTab from './erp/VentasProductoTab';
import RentabilidadClientesTab from './erp/RentabilidadClientesTab';
import RentabilidadVendedoresTab from './erp/RentabilidadVendedoresTab';
import FlujoCajaTab from './erp/FlujoCajaTab';
import ConciliacionTab from './erp/ConciliacionTab';
import BaulTab from './erp/BaulTab';

// Ola 2 (PROPUESTA_UI_ERP §C): Proveedores/OC/CxP se mudaron al módulo
// Compras (/compras) — Finanzas queda con sus 9 secciones en sub-navegación
// vertical agrupada (patrón Zoho/Stripe §B2), ya no 12 tabs en 2 renglones.
const TABS = [
  { grupo: 'FINANZAS', key: 'tablero', label: 'Tablero de dirección', Componente: TableroTab },
  { grupo: 'FINANZAS', key: 'flujo-caja', label: 'Flujo de caja', Componente: FlujoCajaTab },
  { grupo: 'FINANZAS', key: 'contabilidad', label: 'Contabilidad', Componente: ContabilidadTab },
  { grupo: 'FINANZAS', key: 'gastos', label: 'Gastos e impuestos', Componente: GastosImpuestosTab },
  { grupo: 'FINANZAS', key: 'facturacion', label: 'Facturación pendiente', Componente: FacturacionTab },
  { grupo: 'FINANZAS', key: 'conciliacion', label: 'Conciliación bancaria', Componente: ConciliacionTab },
  { grupo: 'FINANZAS', key: 'baul', label: 'Baúl contable (CFDI)', Componente: BaulTab },
  { grupo: 'REPORTES', key: 'ventas-prod', label: 'Ventas por producto', Componente: VentasProductoTab },
  { grupo: 'REPORTES', key: 'rent-clientes', label: 'Rentabilidad por cliente', Componente: RentabilidadClientesTab },
  { grupo: 'REPORTES', key: 'rent-vend', label: 'Rentabilidad por vendedor', Componente: RentabilidadVendedoresTab },
  { grupo: 'REPORTES', key: 'rastro', label: 'Rastro de documento', Componente: RastroTab },
];

export default function Erp() {
  const [sp, setSp] = useSearchParams();
  // Tab deep-linkeable (/erp?tab=cxp — se puede mandar el link a un empleado);
  // sin ?tab= cae al último abierto (localStorage) y luego al Tablero.
  const [tab, setTab] = useState(() => {
    const deUrl = sp.get('tab');
    if (TABS.some(x => x.key === deUrl)) return deUrl;
    const t = (typeof localStorage !== 'undefined') && localStorage.getItem('erp-tab');
    return TABS.some(x => x.key === t) ? t : 'tablero';
  });
  const cambiar = (t) => {
    setTab(t);
    setSp({ tab: t }, { replace: true });
    try { localStorage.setItem('erp-tab', t); } catch (_) {}
  };
  const activoDef = TABS.find(t => t.key === tab) || TABS[0];
  const Activo = activoDef?.Componente;
  const grupos = [...new Set(TABS.map(t => t.grupo))];
  return (
    <div>
      <div className="page-title">Finanzas{activoDef ? ' · ' + activoDef.label : ''}</div>
      <div className="page-sub">Contabilidad, flujo de caja, impuestos y reportes de dirección</div>
      <div className="modulo-layout">
        <nav className="subnav">
          {grupos.map(g => (
            <div key={g}>
              <div className="subnav-grupo">{g}</div>
              {TABS.filter(t => t.grupo === g).map(t => (
                <button key={t.key} className={'subnav-item' + (t.key === tab ? ' activo' : '')} onClick={() => cambiar(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="modulo-contenido">{Activo && <Activo />}</div>
      </div>
    </div>
  );
}
