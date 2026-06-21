import { useEffect, useRef, useState } from 'react';
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

export default function BotStatusWidget() {
  const [estado, setEstado] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const [accionando, setAccionando] = useState(false);
  const ref = useRef(null);

  const cargarEstado = async () => {
    try {
      const data = await api.get('/api/bot/status');
      setEstado(data);
    } catch {
      setEstado({ ok: false, estatus: 'desconocido' });
    }
  };
  const cargarHistorial = async () => {
    try { setHistorial(await api.get('/api/bot/status-history')); } catch { setHistorial([]); }
  };

  useEffect(() => {
    cargarEstado();
    const t = setInterval(cargarEstado, 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    function onClickFuera(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false);
    }
    document.addEventListener('mousedown', onClickFuera);
    return () => document.removeEventListener('mousedown', onClickFuera);
  }, []);

  const abrir = () => {
    setAbierto(v => !v);
    if (!abierto) cargarHistorial();
  };

  const accion = async (ruta) => {
    setAccionando(true);
    try {
      await api.post(`/api/bot/${ruta}`);
      await cargarEstado();
      await cargarHistorial();
    } catch (e) {
      alert(e.message);
    } finally {
      setAccionando(false);
    }
  };

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
          <div className="bot-status-actions">
            <button className="btn" disabled={accionando} onClick={() => accion('start')}>Encender</button>
            <button className="btn" disabled={accionando} onClick={() => accion('restart')}>Reiniciar</button>
            <button className="btn btn-danger" disabled={accionando} onClick={() => accion('stop')}>Apagar</button>
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
