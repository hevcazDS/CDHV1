import { useEffect, useState } from 'react';
import { api } from '../api';

// GET /api/bot/qr es pública (no exige sesión) a propósito: el QR de
// vinculación de WhatsApp tiene que poder verse ANTES de loguearse al
// dashboard (ver dashboard/server.js, esRutaPublica) — App.jsx la usa para
// decidir si muestra el QR o la pantalla de login, e Inicio.jsx la reusa
// para avisar si WhatsApp se desvincula más tarde con la sesión ya abierta.
//
// El QR expira cada ~20-30s y bot/index.js publica uno nuevo en
// `configuracion` en cada refresh (ver bot/index.js client.on('qr')) — hay
// que pollear seguido para no mostrar uno ya vencido.
const QR_POLL_MS = 4000;

export function useWhatsAppQR() {
  const [qr, setQr] = useState(null);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    let activo = true;
    const poll = () => api.get('/api/bot/qr')
      .then(r => { if (activo) { setQr(r?.qr || null); setListo(true); } })
      .catch(() => { if (activo) setListo(true); });
    poll();
    const id = setInterval(poll, QR_POLL_MS);
    return () => { activo = false; clearInterval(id); };
  }, []);

  return { qr, qrListo: listo };
}

export { QR_POLL_MS };
