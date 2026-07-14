// MarketingModulo — Ofertas + Cupones + Lista de espera + Preventas en UNA
// página (Ola 2, PROPUESTA_UI_ERP §C: eran 4 links regados en 2 grupos del
// sidebar). Los componentes de negocio no se tocaron.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs } from '@mantine/core';
import Ofertas from './Ofertas';
import Cupones from './Cupones';
import ListaEspera from './ListaEspera';
import Preventas from './Preventas';

const TABS = [
  { key: 'ofertas', label: 'Ofertas', Componente: Ofertas },
  { key: 'cupones', label: 'Cupones', Componente: Cupones },
  { key: 'lista-espera', label: 'Lista de espera', Componente: ListaEspera },
  { key: 'preventas', label: 'Preventas', Componente: Preventas },
];

export default function MarketingModulo() {
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState(() => TABS.some(t => t.key === sp.get('tab')) ? sp.get('tab') : 'ofertas');
  const cambiar = (t) => { setTab(t); setSp({ tab: t }, { replace: true }); };
  const activo = TABS.find(t => t.key === tab);
  const Activo = activo?.Componente;
  return (
    <div className="sin-scroll">
      <div className="page-title">Marketing · {activo?.label}</div>
      <div className="page-sub">Ofertas, cupones, lista de espera y preventas</div>
      <Tabs value={tab} onChange={cambiar} mb="md">
        <Tabs.List>{TABS.map(t => <Tabs.Tab key={t.key} value={t.key}>{t.label}</Tabs.Tab>)}</Tabs.List>
      </Tabs>
      <div className="modulo-embebido page-scrollable">{Activo && <Activo />}</div>
    </div>
  );
}
