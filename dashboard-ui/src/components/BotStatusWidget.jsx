import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { esAdminOMas } from '../lib/permisos';
import { api } from '../api';
import { confirmar, toastOk, toastErr } from '../lib/ui';

const ETIQUETAS = {
  online: 'En línea',
  stopped: 'Detenido',
  stopping: 'Deteniéndose',
  errored: 'Con error',
  no_iniciado: 'No iniciado',
  desconocido: 'Desconocido',
};

export default function BotStatusWidget() {
  const { user } = useAuth();
  const puedeBridge = esAdminOMas(user?.rol) || ['operador', 'usuario'].includes(user?.rol);
  const queryClient = useQueryClient();
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

  // pm2() corre en un proceso hijo (execFile) — si falla o tarda, no se cae
  // ni se reinicia el proceso del dashboard, solo este request. El botón
  // "Reiniciar" además cierra y reabre la ventana de Electron del lado del
  // servidor (ver /api/bot/restart), así que un solo clic deja todo
  // consistente sin que el operador tenga que hacer nada fuera del panel.
  const accionMutation = useMutation({
    mutationFn: (ruta) => api.post(`/api/bot/${ruta}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bot-status'] });
      queryClient.invalidateQueries({ queryKey: ['bot-status-history'] });
    },
    onError: (e) => toastErr(e.message),
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
        <span className={`bot-icon ${enLinea ? 'online' : 'offline'}`}><Bot size={13} strokeWidth={1.75} /></span>
        {etiqueta}
      </button>
      {abierto && (
        <div className="bot-status-dropdown">
          <h4>Estatus del bot</h4>
          <div className="bot-status-actions">
            <button className="btn" disabled={accionMutation.isPending} onClick={() => accionMutation.mutate('start')}>Encender</button>
            <button className="btn" disabled={accionMutation.isPending} onClick={() => accionMutation.mutate('restart')}>Reiniciar</button>
            <button className="btn btn-danger" disabled={accionMutation.isPending} onClick={() => accionMutation.mutate('stop')}>Apagar</button>
            {puedeBridge && (
              <button className="btn" disabled={accionMutation.isPending} title="Si el bot quedó zombie tras un reinicio del servidor (HS-502)"
                onClick={async () => {
                  if (!await confirmar({ mensaje: '¿Reiniciar el BRIDGE de WhatsApp? (para cuando quedó zombie tras un reload)', textoOk: 'Reiniciar' })) return;
                  const r = await api.post('/api/bot/bridge/restart');
                  if (r.ok) toastOk('Bridge reiniciado'); else toastErr(r.error || 'No se pudo');
                }}>Reiniciar bridge</button>
            )}
          </div>
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
