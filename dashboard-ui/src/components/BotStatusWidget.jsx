import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Emoji } from '../context/EmojiContext';

const ETIQUETAS = {
  online: 'En línea',
  stopped: 'Detenido',
  stopping: 'Deteniéndose',
  errored: 'Con error',
  no_iniciado: 'No iniciado',
  desconocido: 'Desconocido',
};

// Solo informativo a propósito — encender/apagar/reiniciar el bot ya NO se
// dispara desde aquí. Hacerlo desde el propio proceso del dashboard daba la
// sensación de que reiniciar el bot "reiniciaba el dash" (la ventana de
// Electron se cerraba y volvía a abrir en el mismo clic, y todo vivía dentro
// del mismo request HTTP) — confuso e ilógico para el operador. El control
// real ahora es bot-control.bat / scripts/bot-control.ps1, un proceso
// independiente que no depende de que el dashboard esté sano para apagar o
// reiniciar el bot.
export default function BotStatusWidget() {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef(null);

  const { data: estado } = useQuery({
    queryKey: ['bot-status'],
    queryFn: () => api.get('/api/bot/status').catch(() => ({ ok: false, estatus: 'desconocido' })),
    refetchInterval: 15000,
  });

  const { data: historial = [] } = useQuery({
    queryKey: ['bot-status-history'],
    queryFn: () => api.get('/api/bot/status-history').catch(() => []),
    enabled: abierto,
  });

  useEffect(() => {
    function onClickFuera(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false);
    }
    document.addEventListener('mousedown', onClickFuera);
    return () => document.removeEventListener('mousedown', onClickFuera);
  }, []);

  const abrir = () => setAbierto(v => !v);

  const enLinea = estado?.estatus === 'online';
  const etiqueta = ETIQUETAS[estado?.estatus] || estado?.estatus || 'Cargando…';

  return (
    <div className="bot-status" ref={ref}>
      <button className="bot-status-pill" onClick={abrir}>
        <Emoji><span className={`bot-icon ${enLinea ? 'online' : 'offline'}`}>🤖</span></Emoji>
        {etiqueta}
      </button>
      {abierto && (
        <div className="bot-status-dropdown">
          <h4>Estatus del bot</h4>
          <p style={{ fontSize: 12, color: 'var(--text-mute)', margin: '0 0 12px' }}>
            Para encender, apagar o reiniciar el bot usa <code>bot-control.bat</code> en la carpeta
            del proyecto — independiente del dashboard a propósito.
          </p>
          <h4>Historial reciente</h4>
          <div className="bot-history-list">
            {historial.length === 0 && <div className="bot-history-item">Sin cambios registrados aún.</div>}
            {historial.map((h, i) => (
              <div className="bot-history-item" key={i}>
                <span className="estatus">{ETIQUETAS[h.estatus] || h.estatus}{h.motivo ? ` — ${h.motivo}` : ''}</span>
                <span>{h.registrado_en}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
