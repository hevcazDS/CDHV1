import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { useWhatsAppQR } from './hooks/useWhatsAppQR';
import WhatsAppQR from './components/WhatsAppQR';
import Login from './components/Login';
import Layout from './components/Layout';
import Inicio from './pages/Inicio';
import Pedidos from './pages/Pedidos';
import Devoluciones from './pages/Devoluciones';
import Clientes from './pages/Clientes';
import Guias from './pages/Guias';
import ColaAtencion from './pages/ColaAtencion';
import ListaEspera from './pages/ListaEspera';
import Preventas from './pages/Preventas';
import Ofertas from './pages/Ofertas';
import Cupones from './pages/Cupones';
import Sustitutos from './pages/Sustitutos';
import Ranking from './pages/Ranking';
import Modulos from './pages/Modulos';
import Busquedas from './pages/Busquedas';
import ColaEnvios from './pages/ColaEnvios';
import Beta from './pages/Beta';
import Metricas from './pages/Metricas';
import Notificaciones from './pages/Notificaciones';
import Etiquetas from './pages/Etiquetas';
import Prime from './pages/Prime';

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

  if (cargando || !qrListo) return null;
  if (!user && qr) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <WhatsAppQR qr={qr} pantallaCompleta />
      </div>
    );
  }
  if (!user) return <Login />;

  return (
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
        {user.rol === 'prime' && <Route path="/beta" element={<Beta />} />}
        <Route path="/metricas" element={<Metricas />} />
        <Route path="/notificaciones" element={<Notificaciones />} />
        <Route path="/etiquetas" element={<Etiquetas />} />
        {user.rol === 'prime' && <Route path="/prime" element={<Prime />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
