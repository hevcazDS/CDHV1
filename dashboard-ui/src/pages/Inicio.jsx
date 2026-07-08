import { CalendarDays } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWhatsAppQR } from '../hooks/useWhatsAppQR';
import WhatsAppQR from '../components/WhatsAppQR';
import { esAdminOMas } from '../lib/permisos';
import VistaAdmin from './inicio/VistaAdmin';
import VistaOperador from './inicio/VistaOperador';
import VistaCajero from './inicio/VistaCajero';
import VistaFinanzas from './inicio/VistaFinanzas';
import { VistaAlmacen, VistaCompras, VistaRh } from './inicio/VistaEspecialista';

// Inicio por ROL: cada quien ve las métricas de SU trabajo.
// cajero = saludo + su caja · operador = su venta y atención · contabilidad
// = dinero/CxP/balanza · almacén/compras/rh = sus pendientes · admin = todo.
const VISTA_POR_ROL = {
  cajero: VistaCajero,
  operador: VistaOperador,
  usuario: VistaOperador,
  contabilidad: VistaFinanzas,
  almacen: VistaAlmacen,
  compras: VistaCompras,
  rh: VistaRh,
};

const SUBTITULO_POR_ROL = {
  cajero: 'Tu caja de hoy',
  operador: 'Tu venta y atención de hoy',
  contabilidad: 'Dinero cobrado, por cobrar y por pagar',
  almacen: 'Tus pendientes de bodega',
  compras: 'Tus pendientes de adquisición',
  rh: 'Tu gente y la nómina',
};

export default function Inicio() {
  const { user } = useAuth();
  const esAdmin = esAdminOMas(user?.rol);
  // El aviso de WhatsApp desvinculado es de quien opera el bot
  const veQR = esAdmin || user?.rol === 'operador' || user?.rol === 'usuario';
  const { qr } = useWhatsAppQR(veQR, 15000);

  const _fecha = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const hoyLargo = _fecha.charAt(0).toUpperCase() + _fecha.slice(1);
  const Vista = esAdmin ? VistaAdmin : (VISTA_POR_ROL[user?.rol] || VistaCajero);

  return (
    <div className="pagina-llena">
      <div className="page-head">
        <div>
          <div className="page-title">¡Hola, {(user?.username || '').charAt(0).toUpperCase() + (user?.username || '').slice(1)}!</div>
          <div className="page-sub">{esAdmin ? 'Resumen general de la operación' : (SUBTITULO_POR_ROL[user?.rol] || 'Tu día')}</div>
        </div>
        <span className="date-chip"><CalendarDays size={14} strokeWidth={1.75} />{hoyLargo}</span>
      </div>
      {veQR && <WhatsAppQR qr={qr} />}
      <Vista />
    </div>
  );
}
