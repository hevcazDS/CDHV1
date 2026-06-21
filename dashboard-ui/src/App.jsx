import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
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
import Promociones from './pages/Promociones';
import Sustitutos from './pages/Sustitutos';
import Puntos from './pages/Puntos';
import Ranking from './pages/Ranking';
import Modulos from './pages/Modulos';
import Busquedas from './pages/Busquedas';
import ColaEnvios from './pages/ColaEnvios';
import Beta from './pages/Beta';
import Metricas from './pages/Metricas';
import Notificaciones from './pages/Notificaciones';
import Prime from './pages/Prime';

export default function App() {
  const { user, cargando } = useAuth();

  if (cargando) return null;
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
        <Route path="/promociones" element={<Promociones />} />
        <Route path="/sustitutos" element={<Sustitutos />} />
        <Route path="/puntos" element={<Puntos />} />
        <Route path="/ranking" element={<Ranking />} />
        <Route path="/modulos" element={<Modulos />} />
        <Route path="/busquedas" element={<Busquedas />} />
        <Route path="/cola-envios" element={<ColaEnvios />} />
        <Route path="/beta" element={<Beta />} />
        <Route path="/metricas" element={<Metricas />} />
        <Route path="/notificaciones" element={<Notificaciones />} />
        {user.rol === 'prime' && <Route path="/prime" element={<Prime />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
