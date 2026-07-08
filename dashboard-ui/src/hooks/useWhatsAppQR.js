import { useEffect, useState } from 'react';
import { api } from '../api';

// GET /api/bot/qr exige sesión (en servidor, quien vea el QR puede vincular
// el WhatsApp del negocio a su teléfono). Flujo: login primero, QR después —
// App.jsx lo muestra a pantalla completa tras autenticarse si hay uno
// pendiente, e Inicio.jsx lo reusa para avisar si WhatsApp se desvincula
// más tarde con la sesión ya abierta.
//
// El QR expira cada ~20-30s y bot/index.js publica uno nuevo en
// `configuracion` en cada refresh (ver bot/index.js client.on('qr')) — hay
// que pollear seguido para no mostrar uno ya vencido.
const QR_POLL_MS = 4000;

export function useWhatsAppQR(activado = true) {
  const [qr, setQr] = useState(null);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    if (!activado) { setQr(null); setListo(true); return; }
    let activo = true;
    const poll = () => api.get('/api/bot/qr')
      .then(r => { if (activo) { setQr(r?.qr || null); setListo(true); } })
      .catch(() => { if (activo) setListo(true); });
    poll();
    const id = setInterval(poll, QR_POLL_MS);
    return () => { activo = false; clearInterval(id); };
  }, [activado]);

  return { qr, qrListo: listo };
}

export { QR_POLL_MS };
