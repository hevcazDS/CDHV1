import { useState } from 'react';
import { Tabs } from '@mantine/core';
import { useAuth } from '../context/AuthContext';
import { permite, esAdminOMas, esAuditor } from '../lib/permisos';
import ResumenAlmacenTab from './almacen/ResumenAlmacenTab';
import InventarioTab from './almacen/InventarioTab';
import ConteoTab from './almacen/ConteoTab';
import MovimientosTab from './almacen/MovimientosTab';
import KardexTab from './almacen/KardexTab';
import CalendarioTab from './almacen/CalendarioTab';
import ReportesTab from './almacen/ReportesTab';

export default function Almacen() {
  const { user } = useAuth();
  const auditor = esAuditor(user?.rol);
  const soloLectura = auditor || !permite(user?.rol, 'almacen') || (permite(user?.rol, 'almacen_lectura') && !esAdminOMas(user?.rol) && user?.rol !== 'almacen');
  const veKardex = esAdminOMas(user?.rol) || auditor; // material de auditoría
  const veReportes = esAdminOMas(user?.rol); // muestran costo/margen → gerente+
  const opera = !soloLectura;
  const TABS = [
    { key: 'resumen', label: 'Resumen', C: ResumenAlmacenTab },
    { key: 'inventario', label: 'Inventario y ubicaciones', C: InventarioTab },
    { key: 'calendario', label: 'Calendario de mercancía', C: CalendarioTab },
    ...(veReportes ? [{ key: 'reportes', label: 'Reportes (stock/margen/rotación)', C: ReportesTab }] : []),
    ...(opera ? [
      { key: 'conteo', label: 'Conteo físico', C: ConteoTab },
      { key: 'movimientos', label: 'Traslados / Salidas / Entradas', C: MovimientosTab },
    ] : []),
    ...(veKardex ? [{ key: 'kardex', label: 'Kardex (auditoría)', C: KardexTab }] : []),
  ];
  const [tab, setTab] = useState('resumen');
  const Activo = TABS.find(t => t.key === tab)?.C;
  return (
    <div>
      <div className="page-title">Almacén</div>
      <div className="page-sub">{auditor ? 'Lectura de auditoría' : soloLectura ? 'Inventario en solo lectura' : 'Inventario, ubicaciones, conteos y movimientos'}</div>
      <Tabs value={tab} onChange={setTab} mb="md">
        <Tabs.List>{TABS.map(t => <Tabs.Tab key={t.key} value={t.key}>{t.label}</Tabs.Tab>)}</Tabs.List>
      </Tabs>
      {Activo && <Activo soloLectura={soloLectura} />}
    </div>
  );
}
