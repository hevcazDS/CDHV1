import { useState } from 'react';
import { Tabs } from '@mantine/core';
import { useAuth } from '../context/AuthContext';
import { permite } from '../lib/permisos';
import InventarioTab from './almacen/InventarioTab';
import ConteoTab from './almacen/ConteoTab';
import MovimientosTab from './almacen/MovimientosTab';

export default function Almacen() {
  const { user } = useAuth();
  const soloLectura = !permite(user?.rol, 'almacen'); // compras entra en lectura
  const TABS = [
    { key: 'inventario', label: 'Inventario y ubicaciones', C: InventarioTab },
    ...(soloLectura ? [] : [
      { key: 'conteo', label: 'Conteo físico', C: ConteoTab },
      { key: 'movimientos', label: 'Traslados / Salidas / Kardex', C: MovimientosTab },
    ]),
  ];
  const [tab, setTab] = useState('inventario');
  const Activo = TABS.find(t => t.key === tab)?.C;
  return (
    <div>
      <div className="page-title">Almacén</div>
      <div className="page-sub">{soloLectura ? 'Inventario en solo lectura' : 'Inventario, ubicaciones, conteos y kardex'}</div>
      <Tabs value={tab} onChange={setTab} mb="md">
        <Tabs.List>{TABS.map(t => <Tabs.Tab key={t.key} value={t.key}>{t.label}</Tabs.Tab>)}</Tabs.List>
      </Tabs>
      {Activo && <Activo soloLectura={soloLectura} />}
    </div>
  );
}
