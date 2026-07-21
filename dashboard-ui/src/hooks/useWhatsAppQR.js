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
    // listo=false (no true) al desactivar: "true" aquí engañaba al que
    // consume el hook, haciéndole creer que YA se resolvió una consulta que
    // en realidad nunca se hizo — cerraba el modal de "Vincular WhatsApp"
    // antes de que la petición real llegara a responder.
    if (!activado) { setQr(null); setListo(false); return; }
    let activo = true;
    setListo(false); // por si quedó "true" de una activación anterior
    const poll = () => api.get('/api/bot/qr')
      .then(r => {
        if (!activo) return;
        // actualizado_en viene de SQLite con datetime('now','localtime') —
        // texto SIN zona horaria en hora de Monterrey (TZ del contenedor).
        // new Date('YYYY-MM-DD HH:MM:SS') lo interpreta como UTC (bug real,
        // confirmado: siempre daba ~6h de "antigüedad" y tiraba el QR SIEMPRE
        // por "viejo"). México no tiene horario de verano desde 2022, así que
        // el offset fijo -06:00 es seguro.
        const iso = r?.actualizado_en ? r.actualizado_en.replace(' ', 'T') + '-06:00' : null;
        const age = iso ? Date.now() - new Date(iso).getTime() : Infinity;
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
