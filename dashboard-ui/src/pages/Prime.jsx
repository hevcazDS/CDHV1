// Prime.jsx — Orquestador de la página Prime/Gestión. Cada tab vive en su
// propio componente bajo pages/prime/ (antes este archivo tenía ~1390 líneas
// con todos los tabs juntos; se partió por mantenibilidad). El estado/queries/
// mutations de cada tab viven en su componente; las queries compartidas
// (sucursales, categorías) se piden por la misma queryKey de React Query, que
// las deduplica, así que no hay doble fetch.
import { useState } from 'react';
import { Tabs } from '@mantine/core';
import { useTextoEmoji } from '../context/EmojiContext';
import { useAuth } from '../context/AuthContext';
import GeneralTab from './prime/GeneralTab';
import SucursalesTab from './prime/SucursalesTab';
import InventarioTab from './prime/InventarioTab';
import CatalogoTab from './prime/CatalogoTab';
import UsuariosTab from './prime/UsuariosTab';
import DatosLLMTab from './prime/DatosLLMTab';
import BotEditorTab from './prime/BotEditorTab';
import FiltrosTab from './prime/FiltrosTab';

// soloPrime: integraciones, identidad del negocio, gestión de usuarios y
// exportación de datos del LLM son exclusivas de prime. El gerente ve
// sucursales/inventario/catálogo/filtros (operación del catálogo), coherente
// con los permisos del backend.
const TABS = [
  { key: 'general', label: 'General', soloPrime: true, Componente: GeneralTab },
  { key: 'sucursales', label: 'Sucursales', Componente: SucursalesTab },
  { key: 'inventario', label: 'Inventario', Componente: InventarioTab },
  { key: 'catalogo', label: 'Catálogo', Componente: CatalogoTab },
  { key: 'usuarios', label: 'Usuarios', soloPrime: false, Componente: UsuariosTab },
  { key: 'bot', label: 'Editor del bot', soloPrime: true, Componente: BotEditorTab },
  { key: 'datos', label: 'Datos LLM', soloPrime: true, Componente: DatosLLMTab },
  { key: 'filtros', label: 'Filtros', Componente: FiltrosTab },
];

export default function Prime() {
  const txt = useTextoEmoji();
  const { user } = useAuth();
  const esPrime = user?.rol === 'prime';
  const tabsVisibles = TABS.filter(t => esPrime || !t.soloPrime);
  const [tab, setTab] = useState(tabsVisibles[0]?.key || 'sucursales');
  const TabActivo = tabsVisibles.find(t => t.key === tab)?.Componente;

  return (
    <div>
      <div className="page-title">{esPrime ? 'Prime' : 'Gestión'}</div>
      <div className="page-sub">{esPrime ? 'Configuración avanzada — rol prime' : 'Sucursales, inventario y catálogo'}</div>

      <Tabs value={tab} onChange={setTab} mb="md">
        <Tabs.List>
          {tabsVisibles.map(t => <Tabs.Tab key={t.key} value={t.key}>{txt(t.label)}</Tabs.Tab>)}
        </Tabs.List>
      </Tabs>

      {TabActivo && <TabActivo />}
    </div>
  );
}
