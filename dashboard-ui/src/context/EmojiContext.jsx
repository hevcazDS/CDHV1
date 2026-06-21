import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api';

// Toggle global de emojis en el dashboard — clave 'emojis_dashboard_activo'
// en `configuracion`, mismo patrón genérico que el resto de módulos
// (GET /api/modulo/:clave, POST /api/puntos/config). Pensado como paso
// intermedio mientras se migra a un template nuevo: permite quitar el
// "ruido" visual de emojis sin tocar cada archivo de golpe.
const EmojiContext = createContext(true);

// Quita CUALQUIER emoji de un texto (no solo al inicio) — permite envolver
// strings ya armados (títulos de tarjetas, mensajes de estado, botones) sin
// tener que partir cada literal en "emoji" + "texto" por separado. Incluye
// el selector de variación (️, ej. el de ↩️) y el ZWJ (‍, usado en
// emojis compuestos) para que no queden residuos invisibles tras la limpieza.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️‍]/gu;
function quitarEmojis(texto) {
  return String(texto ?? '').replace(EMOJI_RE, '').replace(/ {2,}/g, ' ').trim();
}

export function EmojiProvider({ children }) {
  const [activo, setActivo] = useState(true);

  useEffect(() => {
    api.get('/api/modulo/emojis_dashboard_activo')
      .then(r => { if (r && typeof r.activo === 'boolean') setActivo(r.activo); })
      .catch(() => {});
  }, []);

  return <EmojiContext.Provider value={activo}>{children}</EmojiContext.Provider>;
}

// Para JSX: <Emoji>🤖</Emoji> — no renderiza nada si está apagado.
export function Emoji({ children }) {
  const activo = useContext(EmojiContext);
  return activo ? children : null;
}

// Para interpolar un solo emoji dentro de texto: {emoji('🤖')}En línea —
// incluye el espacio de separación cuando está activo, para no dejar un
// espacio huérfano cuando los emojis están apagados.
export function useEmoji() {
  const activo = useContext(EmojiContext);
  return (caracter) => (activo ? caracter + ' ' : '');
}

// Para strings ya armados con emojis en cualquier posición (títulos,
// mensajes de estado, badges): {t('🤖 Estatus del bot')} → sin tocar el
// emoji si está activo, o lo quita (y el espacio sobrante) si no.
export function useTextoEmoji() {
  const activo = useContext(EmojiContext);
  return (texto) => (activo ? texto : quitarEmojis(texto));
}

export function useEmojisActivos() {
  return useContext(EmojiContext);
}
