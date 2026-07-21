import { useEffect, useState } from 'react';
import { api } from '../api';

// El QR expira cada ~20-30s (el bot publica uno nuevo en `configuracion`
// en cada refresh), por eso el poll corto. El endpoint exige sesión.
const QR_POLL_MS = 4000;
// Si el bot conectó (o murió) sin limpiar la BD, el timestamp queda viejo.
// Más de 2 min sin renovar = QR inútil; no bloquear al operador con él.
const QR_MAX_AGE_MS = 2 * 60 * 1000;

export function useWhatsAppQR(activado = true, intervaloMs = QR_POLL_MS) {
  const [qr, setQr] = useState(null);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    if (!activado) { setQr(null); setListo(true); return; }
    let activo = true;
    const poll = () => api.get('/api/bot/qr')
      .then(r => {
        if (!activo) return;
        const age = r?.actualizado_en ? Date.now() - new Date(r.actualizado_en).getTime() : Infinity;
        setQr(r?.qr && age < QR_MAX_AGE_MS ? r.qr : null);
        setListo(true);
      })
      .catch(() => { if (activo) setListo(true); });
    poll();
    const id = setInterval(poll, intervaloMs);
    return () => { activo = false; clearInterval(id); };
  }, [activado, intervaloMs]);

  return { qr, qrListo: listo };
}

export { QR_POLL_MS };
