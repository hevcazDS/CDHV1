import { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader, Center } from '@mantine/core';
import { useAuth } from './context/AuthContext';
import { useWhatsAppQR } from './hooks/useWhatsAppQR';
import { api } from './api';
import { tieneRango } from './lib/roles';
import WhatsAppQR from './components/WhatsAppQR';
import Login from './components/Login';
import Onboarding from './components/Onboarding';
import Layout from './components/Layout';

// Páginas en carga diferida (code-splitting): cada una se descarga como su
// propio chunk al navegar, en vez de meterlas todas en el bundle inicial
// (antes ~1.1 MB en un solo archivo). El shell (Login/Onboarding/Layout)
// sigue siendo eager porque se necesita de inmediato.
const Inicio = lazy(() => import('./pages/Inicio'));
const Pedidos = lazy(() => import('./pages/Pedidos'));
const Devoluciones = lazy(() => import('./pages/Devoluciones'));
const Clientes = lazy(() => import('./pages/Clientes'));
const Guias = lazy(() => import('./pages/Guias'));
const ColaAtencion = lazy(() => import('./pages/ColaAtencion'));
const ListaEspera = lazy(() => import('./pages/ListaEspera'));
const Preventas = lazy(() => import('./pages/Preventas'));
const Ofertas = lazy(() => import('./pages/Ofertas'));
const Cupones = lazy(() => import('./pages/Cupones'));
const Sustitutos = lazy(() => import('./pages/Sustitutos'));
const Ranking = lazy(() => import('./pages/Ranking'));
const Modulos = lazy(() => import('./pages/Modulos'));
const Busquedas = lazy(() => import('./pages/Busquedas'));
const ColaEnvios = lazy(() => import('./pages/ColaEnvios'));
const Beta = lazy(() => import('./pages/Beta'));
const Metricas = lazy(() => import('./pages/Metricas'));
const Notificaciones = lazy(() => import('./pages/Notificaciones'));
const Etiquetas = lazy(() => import('./pages/Etiquetas'));
const Mostrador = lazy(() => import('./pages/Mostrador'));
const Prime = lazy(() => import('./pages/Prime'));

export default function App() {
  const { user, cargando } = useAuth();
  // Vincular WhatsApp y loguearse al dashboard son cosas independientes —
  // antes el QR solo vivía dentro de Inicio, que nunca se monta sin sesión
  // de dashboard, así que abrir Electron por primera vez (sin login todavía)
  // no tenía ninguna forma de mostrarlo. Esta compuerta corre ANTES que la
  // decisión de login, pero SOLO si todavía no hay sesión — si ya hay una
  // sesión de dashboard abierta y WhatsApp se desvincula después, no se debe
  // expulsar al operador a una pantalla completa: ese caso ya lo cubre el
  // aviso dentro de Inicio.jsx, sin sacarlo de donde esté trabajando.
  const { qr, qrListo } = useWhatsAppQR();

  // Estado de onboarding: una instancia recién clonada (negocio_configurado
  // ausente) muestra el alta desde cero ANTES del login. La de Julio Cepeda
  // ya quedó configurada por la migración 0014, así que esto es transparente.
  const [onb, setOnb] = useState(undefined);
  useEffect(() => {
    api.get('/api/onboarding/estado').then(setOnb).catch(() => setOnb({ configurado: true }));
  }, []);

  if (cargando || !qrListo || onb === undefined) return null;
  if (!user && !onb.configurado) return <Onboarding estado={onb} />;
  if (!user && qr) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <WhatsAppQR qr={qr} pantallaCompleta />
      </div>
    );
  }
  if (!user) return <Login />;

  return (
    <Suspense fallback={<Center style={{ minHeight: '60vh' }}><Loader /></Center>}>
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Inicio />} />
        <Route path="/pedidos" element={<Pedidos />} />
        <Route path="/devoluciones" element={<Devoluciones />} />
        <Route path="/clientes" element={<Clientes />} />
        <Route path="/guias" element={<Guias />} />
        <Route path="/cola" element={<ColaAtencion />} />
        <Route path="/lista-espera" element={<ListaEspera />} />
        <Route path="/preventas" element={<Preventas />} />
        <Route path="/ofertas" element={<Ofertas />} />
        <Route path="/cupones" element={<Cupones />} />
        <Route path="/sustitutos" element={<Sustitutos />} />
        <Route path="/ranking" element={<Ranking />} />
        <Route path="/modulos" element={<Modulos />} />
        <Route path="/busquedas" element={<Busquedas />} />
        <Route path="/cola-envios" element={<ColaEnvios />} />
        {tieneRango(user.rol, 'prime') && <Route path="/beta" element={<Beta />} />}
        <Route path="/metricas" element={<Metricas />} />
        <Route path="/notificaciones" element={<Notificaciones />} />
        <Route path="/etiquetas" element={<Etiquetas />} />
        <Route path="/mostrador" element={<Mostrador />} />
        {tieneRango(user.rol, 'gerente') && <Route path="/prime" element={<Prime />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
