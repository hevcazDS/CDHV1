// Prime.jsx — Orquestador de la página Prime/Gestión. Cada tab vive en su
// propio componente bajo pages/prime/ (antes este archivo tenía ~1390 líneas
// con todos los tabs juntos; se partió por mantenibilidad). El estado/queries/
// mutations de cada tab viven en su componente; las queries compartidas
// (sucursales, categorías) se piden por la misma queryKey de React Query, que
// las deduplica, así que no hay doble fetch.
import { useState, useEffect, lazy } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs } from '@mantine/core';
import { useTextoEmoji } from '../context/EmojiContext';
import { useAuth } from '../context/AuthContext';
import GeneralTab from './prime/GeneralTab';
import SucursalesTab from './prime/SucursalesTab';
import UsuariosTab from './prime/UsuariosTab';
import DatosLLMTab from './prime/DatosLLMTab';
import BotEditorTab from './prime/BotEditorTab';
import MotorTab from './prime/MotorTab';
import FiltrosTab from './prime/FiltrosTab';
const DemoTab = lazy(() => import('./prime/DemoTab'));

// soloPrime: integraciones, identidad del negocio, gestión de usuarios y
// exportación de datos del LLM son exclusivas de prime.
// Ola 2 (PROPUESTA_UI_ERP §C): los tabs de OPERACIÓN salieron de aquí —
// Catálogo es página propia (/catalogo) e Inventario vive en Almacén; esta
// página queda como ajustes reales (era el "cajón de sastre" del diagnóstico).
const TABS = [
  { key: 'general', label: 'General', soloPrime: true, Componente: GeneralTab },
  { key: 'sucursales', label: 'Sucursales', Componente: SucursalesTab },
  { key: 'usuarios', label: 'Usuarios', soloPrime: false, Componente: UsuariosTab },
  { key: 'bot', label: 'Editor del bot', soloPrime: true, Componente: BotEditorTab },
  { key: 'motor', label: 'Motor de flujo', soloPrime: true, Componente: MotorTab },
  { key: 'datos', label: 'Datos LLM', soloPrime: true, Componente: DatosLLMTab },
  { key: 'filtros', label: 'Filtros', Componente: FiltrosTab },
  { key: 'demo', label: '🎲 Demo', soloPrime: true, Componente: DemoTab },
];

export default function Prime() {
  const txt = useTextoEmoji();
  const { user } = useAuth();
  const esPrime = user?.rol === 'prime';
  const tabsVisibles = TABS.filter(t => esPrime || !t.soloPrime);
  // Permite entrar directo a una pestaña vía ?tab=usuarios (el link "Usuarios"
  // del sidebar). Si el tab pedido no es visible para el rol, cae al primero.
  const [params] = useSearchParams();
  const tabPedido = params.get('tab');
  const [tab, setTab] = useState(tabsVisibles.find(t => t.key === tabPedido)?.key || tabsVisibles[0]?.key || 'sucursales');
  // Si ya estás en /prime y el link cambia solo el ?tab= (Usuarios vs
  // Configuración), la página no remonta → hay que sincronizar la pestaña.
  useEffect(() => {
    const k = tabsVisibles.find(t => t.key === tabPedido)?.key;
    if (k) setTab(k);
  }, [tabPedido]); // eslint-disable-line react-hooks/exhaustive-deps
  const TabActivo = tabsVisibles.find(t => t.key === tab)?.Componente;

  return (
    <div className="sin-scroll">
      <div className="page-title">Configuración</div>
      <div className="page-sub">{esPrime ? 'Identidad del negocio, sucursales, usuarios y bot — rol prime' : 'Sucursales, usuarios y filtros'}</div>

      <Tabs value={tab} onChange={setTab} mb="md">
        <Tabs.List>
          {tabsVisibles.map(t => <Tabs.Tab key={t.key} value={t.key}>{txt(t.label)}</Tabs.Tab>)}
        </Tabs.List>
      </Tabs>

      <div className="page-scrollable">{TabActivo && <TabActivo />}</div>
    </div>
  );
}
