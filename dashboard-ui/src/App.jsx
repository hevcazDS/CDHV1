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
  // Orden del primer arranque: login PRIMERO (el QR exige sesión — en
  // servidor quien vea el QR puede vincular el WhatsApp del negocio), y si
  // tras autenticarse hay un QR pendiente se muestra a pantalla completa
  // solo esa primera vez (mostrarQR arranca en true y se apaga al escanear
  // o al continuar). Si WhatsApp se desvincula después, el aviso dentro de
  // Inicio.jsx lo cubre sin expulsar al operador de donde esté trabajando.
  const { qr, qrListo } = useWhatsAppQR(!!user);
  const [qrVisto, setQrVisto] = useState(false);

  // Estado de onboarding: una instancia recién clonada (negocio_configurado
  // ausente) muestra el alta desde cero ANTES del login. La de Julio Cepeda
  // ya quedó configurada por la migración 0014, así que esto es transparente.
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
