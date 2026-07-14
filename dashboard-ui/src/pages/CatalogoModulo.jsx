// CatalogoModulo — el catálogo POR FIN vive en el grupo "Catálogo" (Ola 2,
// PROPUESTA_UI_ERP §A3: el alta de productos estaba enterrada en
// Configuración → Prime → 4º tab, y el grupo "Catálogo e inventario" del
// sidebar no contenía el catálogo). Productos = prime/CatalogoTab intacto.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs } from '@mantine/core';
import CatalogoTab from './prime/CatalogoTab';
import Etiquetas from './Etiquetas';
import Sustitutos from './Sustitutos';

const TABS = [
  { key: 'productos', label: 'Productos', Componente: CatalogoTab },
  { key: 'etiquetas', label: 'Etiquetas', Componente: Etiquetas },
  { key: 'relacionados', label: 'Relacionados', Componente: Sustitutos },
];

export default function CatalogoModulo() {
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState(() => TABS.some(t => t.key === sp.get('tab')) ? sp.get('tab') : 'productos');
  const cambiar = (t) => { setTab(t); setSp({ tab: t }, { replace: true }); };
  const activo = TABS.find(t => t.key === tab);
  const Activo = activo?.Componente;
  return (
    <div className="sin-scroll">
      <div className="page-title">Catálogo · {activo?.label}</div>
      <div className="page-sub">Alta y edición de productos, etiquetas de visión y relacionados</div>
      <Tabs value={tab} onChange={cambiar} mb="md">
        <Tabs.List>{TABS.map(t => <Tabs.Tab key={t.key} value={t.key}>{t.label}</Tabs.Tab>)}</Tabs.List>
      </Tabs>
      <div className="modulo-embebido page-scrollable">{Activo && <Activo />}</div>
    </div>
  );
}
