import { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader, Center } from '@mantine/core';
import { useAuth } from './context/AuthContext';
import { useWhatsAppQR } from './hooks/useWhatsAppQR';
import { api } from './api';
import { tieneRango } from './lib/roles';
import { permite } from './lib/permisos';
import WhatsAppQR from './components/WhatsAppQR';
import Login from './components/Login';
import Onboarding from './components/Onboarding';
import Layout from './components/Layout';
import { UiHost } from './lib/ui';

// Páginas lazy (code-splitting); el shell Login/Onboarding/Layout es eager
const Inicio = lazy(() => import('./pages/Inicio'));
const Pedidos = lazy(() => import('./pages/Pedidos'));
const Devoluciones = lazy(() => import('./pages/Devoluciones'));
const Clientes = lazy(() => import('./pages/Clientes'));
const Crm = lazy(() => import('./pages/Crm'));
const Mensajes = lazy(() => import('./pages/Mensajes'));
const Asistencias = lazy(() => import('./pages/Asistencias'));
const Guias = lazy(() => import('./pages/Guias'));
const ColaAtencion = lazy(() => import('./pages/ColaAtencion'));
const MarketingModulo = lazy(() => import('./pages/MarketingModulo'));
const CatalogoModulo = lazy(() => import('./pages/CatalogoModulo'));
const Ranking = lazy(() => import('./pages/Ranking'));
const Modulos = lazy(() => import('./pages/Modulos'));
const Busquedas = lazy(() => import('./pages/Busquedas'));
const ColaEnvios = lazy(() => import('./pages/ColaEnvios'));
const Beta = lazy(() => import('./pages/Beta'));
const Metricas = lazy(() => import('./pages/Metricas'));
const Notificaciones = lazy(() => import('./pages/Notificaciones'));
const Mostrador = lazy(() => import('./pages/Mostrador'));
const Prime = lazy(() => import('./pages/Prime'));
const Erp = lazy(() => import('./pages/Erp'));
const Almacen = lazy(() => import('./pages/Almacen'));
const ComprasModulo = lazy(() => import('./pages/ComprasModulo'));
const Rrhh = lazy(() => import('./pages/Rrhh'));
const Citas = lazy(() => import('./pages/Citas'));
const OrdenesServicio = lazy(() => import('./pages/OrdenesServicio'));
const Suscripciones = lazy(() => import('./pages/Suscripciones'));
const Documentos = lazy(() => import('./pages/Documentos'));
const Mesas = lazy(() => import('./pages/Mesas'));
const Cocina = lazy(() => import('./pages/Cocina'));
const Fiados = lazy(() => import('./pages/Fiados'));
const Tareas = lazy(() => import('./pages/Tareas'));

export default function App() {
  const { user, cargando } = useAuth();
  // Login primero, QR después (el endpoint del QR exige sesión). El poll
  // se detiene al vincular o descartar; Inicio cubre desvinculaciones.
  const [qrVisto, setQrVisto] = useState(false);
  const { qr, qrListo } = useWhatsAppQR(!!user && !qrVisto);

  const [onb, setOnb] = useState(undefined);
  useEffect(() => {
    api.get('/api/onboarding/estado').then(setOnb).catch(() => setOnb({ configurado: true }));
  }, []);

  if (cargando || onb === undefined) return null;
  if (!user && !onb.configurado) return <Onboarding estado={onb} />;
  if (!user) return <Login />;
  if (!qrListo) return null;
  if (qr && !qrVisto) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <WhatsAppQR qr={qr} pantallaCompleta />
        <button className="btn" onClick={() => setQrVisto(true)}>Continuar al panel sin vincular</button>
      </div>
    );
  }

  return (
    <>
    <UiHost />
    <Suspense fallback={<Center style={{ minHeight: '60vh' }}><Loader /></Center>}>
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Inicio />} />
        <Route path="/tareas" element={<Tareas />} />
        <Route path="/mensajes" element={<Mensajes />} />
        <Route path="/asistencias" element={<Asistencias />} />
        <Route path="/pedidos" element={<Pedidos />} />
        <Route path="/devoluciones" element={<Devoluciones />} />
        {permite(user.rol, 'operacion') && <Route path="/clientes" element={<Clientes />} />}
        {permite(user.rol, 'operacion') && <Route path="/crm" element={<Crm />} />}
        <Route path="/guias" element={<Guias />} />
        <Route path="/cola" element={<ColaAtencion />} />
        {/* Ola 2: Marketing y Catálogo son módulos; las rutas viejas redirigen */}
        {tieneRango(user.rol, 'gerente') && <Route path="/marketing" element={<MarketingModulo />} />}
        {tieneRango(user.rol, 'gerente') && <Route path="/catalogo" element={<CatalogoModulo />} />}
        <Route path="/lista-espera" element={<Navigate to="/marketing?tab=lista-espera" replace />} />
        <Route path="/preventas" element={<Navigate to="/marketing?tab=preventas" replace />} />
        <Route path="/ofertas" element={<Navigate to="/marketing?tab=ofertas" replace />} />
        <Route path="/cupones" element={<Navigate to="/marketing?tab=cupones" replace />} />
        <Route path="/sustitutos" element={<Navigate to="/catalogo?tab=relacionados" replace />} />
        <Route path="/ranking" element={<Ranking />} />
        <Route path="/modulos" element={<Modulos />} />
        <Route path="/busquedas" element={<Busquedas />} />
        <Route path="/cola-envios" element={<ColaEnvios />} />
        {tieneRango(user.rol, 'prime') && <Route path="/beta" element={<Beta />} />}
        <Route path="/metricas" element={<Metricas />} />
        {permite(user.rol, 'operacion') && <Route path="/notificaciones" element={<Notificaciones />} />}
        <Route path="/etiquetas" element={<Navigate to="/catalogo?tab=etiquetas" replace />} />
        {permite(user.rol, 'pos') && <Route path="/mostrador" element={<Mostrador />} />}
        {tieneRango(user.rol, 'gerente') && <Route path="/prime" element={<Prime />} />}
        {/* Ola 2: /erp es solo finanzas — el ciclo de compras vive en /compras */}
        {permite(user.rol, 'finanzas') && <Route path="/erp" element={<Erp />} />}
        {(permite(user.rol, 'compras') || permite(user.rol, 'finanzas')) && <Route path="/compras" element={<ComprasModulo />} />}
        {(permite(user.rol, 'almacen') || permite(user.rol, 'almacen_lectura')) && <Route path="/almacen" element={<Almacen />} />}
        {permite(user.rol, 'rrhh') && <Route path="/rrhh" element={<Rrhh />} />}
              {permite(user.rol, 'operacion') && <Route path="/citas" element={<Citas />} />}
              {permite(user.rol, 'operacion') && <Route path="/ordenes-servicio" element={<OrdenesServicio />} />}
              {permite(user.rol, 'operacion') && <Route path="/suscripciones" element={<Suscripciones />} />}
              {permite(user.rol, 'operacion') && <Route path="/documentos" element={<Documentos />} />}
              {(permite(user.rol, 'pos') || permite(user.rol, 'operacion')) && <Route path="/mesas" element={<Mesas />} />}
              {(permite(user.rol, 'pos') || permite(user.rol, 'operacion')) && <Route path="/cocina" element={<Cocina />} />}
              {(permite(user.rol, 'pos') || permite(user.rol, 'finanzas')) && <Route path="/fiados" element={<Fiados />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
    </>
  );
}
