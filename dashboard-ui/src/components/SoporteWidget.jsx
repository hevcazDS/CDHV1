import { useEffect, useState } from 'react';
import { api } from '../api';

// Widget flotante de soporte del PROVEEDOR de software (Hevcaz Solutions).
// Aparece en todas las instancias (es la marca del proveedor, no del cliente).
// Al presionarlo abre un panel para contactar soporte por WhatsApp/correo.
// El contacto se lee de /api/soporte (configurable por env SOPORTE_HEVCAZ_*).
export default function SoporteWidget() {
  const [abierto, setAbierto] = useState(false);
  const [info, setInfo] = useState(null);

  useEffect(() => { api.get('/api/soporte').then(setInfo).catch(() => {}); }, []);

  const nombre = info?.nombre || 'Hevcaz Solutions';
  const waUrl = info?.whatsapp
    ? `https://wa.me/${info.whatsapp}?text=${encodeURIComponent('Hola, necesito soporte con mi sistema.')}`
    : null;

  return (
    <>
      {abierto && (
        <div style={{
          position: 'fixed', bottom: 78, right: 18, width: 270, zIndex: 1000,
          background: 'var(--card, #1b1b2b)', border: '1px solid var(--border, #333)',
          borderRadius: 12, padding: 16, boxShadow: '0 8px 30px rgba(0,0,0,.45)',
        }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>🛟 Soporte técnico</div>
          <div style={{ fontSize: 12, color: 'var(--text-mute, #99a)', marginBottom: 12 }}>
            ¿Algo no funciona? Escríbenos y te ayudamos (o nos conectamos en remoto).
          </div>
          {waUrl ? (
            <a href={waUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary"
               style={{ width: '100%', justifyContent: 'center', textDecoration: 'none', marginBottom: 8 }}>
              💬 Contactar por WhatsApp
            </a>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-mute,#99a)', marginBottom: 8 }}>
              Configura <code>SOPORTE_HEVCAZ_WHATSAPP</code> en el .env para habilitar el contacto.
            </div>
          )}
          {info?.email && (
            <a href={`mailto:${info.email}`} className="btn" style={{ width: '100%', justifyContent: 'center', textDecoration: 'none' }}>
              ✉️ {info.email}
            </a>
          )}
          <div style={{ fontSize: 10, color: 'var(--text-mute,#778)', textAlign: 'center', marginTop: 12 }}>
            Powered by <strong>{nombre}</strong>
          </div>
        </div>
      )}
      <button
        onClick={() => setAbierto(a => !a)}
        title={`Soporte — ${nombre}`}
        style={{
          position: 'fixed', bottom: 18, right: 18, zIndex: 1000,
          width: 52, height: 52, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: 'var(--accent, #5b7cfa)', color: '#fff', fontSize: 22,
          boxShadow: '0 6px 20px rgba(0,0,0,.4)',
        }}>
        {abierto ? '✕' : '🛟'}
      </button>
    </>
  );
}
