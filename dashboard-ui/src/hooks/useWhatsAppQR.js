import { useEffect, useState } from 'react';
import { api } from '../api';

// El QR expira cada ~20-30s (el bot publica uno nuevo en `configuracion`
// en cada refresh), por eso el poll corto. El endpoint exige sesión.
const QR_POLL_MS = 4000;

export function useWhatsAppQR(activado = true, intervaloMs = QR_POLL_MS) {
  const [qr, setQr] = useState(null);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    if (!activado) { setQr(null); setListo(true); return; }
    let activo = true;
    const poll = () => api.get('/api/bot/qr')
      .then(r => { if (activo) { setQr(r?.qr || null); setListo(true); } })
      .catch(() => { if (activo) setListo(true); });
    poll();
    const id = setInterval(poll, intervaloMs);
    return () => { activo = false; clearInterval(id); };
  }, [activado, intervaloMs]);

  return { qr, qrListo: listo };
}

export { QR_POLL_MS };
