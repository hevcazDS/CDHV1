import { useEffect, useState } from 'react';
import Modal from '../components/Modal';

// Reemplazo de window.alert/confirm nativos (auditoría UX/UI + cajero) SIN
// dependencias nuevas: un bus de eventos + hosts montados una vez en App.

const bus = new EventTarget();

export function toastOk(msg) { bus.dispatchEvent(new CustomEvent('toast', { detail: { msg, tipo: 'ok' } })); }
export function toastErr(msg) { bus.dispatchEvent(new CustomEvent('toast', { detail: { msg, tipo: 'err' } })); }

// Devuelve una promesa true/false — reemplaza window.confirm.
export function confirmar({ titulo = 'Confirmar', mensaje, peligro = false, textoOk = 'Aceptar' }) {
  return new Promise((resolve) => {
    bus.dispatchEvent(new CustomEvent('confirm', { detail: { titulo, mensaje, peligro, textoOk, resolve } }));
  });
}

// Montar UNA vez en App (junto al Layout).
export function UiHost() {
  const [toasts, setToasts] = useState([]);
  const [conf, setConf] = useState(null);

  useEffect(() => {
    const onToast = (e) => {
      const id = Date.now() + Math.random();
      setToasts(t => [...t, { id, ...e.detail }]);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), e.detail.tipo === 'err' ? 4000 : 2500);
    };
    const onConfirm = (e) => setConf(e.detail);
    bus.addEventListener('toast', onToast);
    bus.addEventListener('confirm', onConfirm);
    return () => { bus.removeEventListener('toast', onToast); bus.removeEventListener('confirm', onConfirm); };
  }, []);

  const cerrar = (val) => { if (conf) { conf.resolve(val); setConf(null); } };

  return (
    <>
      <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 500, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: t.tipo === 'err' ? 'var(--red)' : 'var(--green)', color: '#fff',
            padding: '10px 16px', borderRadius: 8, fontSize: 13, maxWidth: 340,
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          }}>{t.msg}</div>
        ))}
      </div>
      {conf && (
        <Modal title={conf.titulo} onClose={() => cerrar(false)}
          actions={<>
            <button className="btn" onClick={() => cerrar(false)}>Cancelar</button>
            <button className={'btn ' + (conf.peligro ? 'btn-danger' : 'btn-primary')} onClick={() => cerrar(true)}>{conf.textoOk}</button>
          </>}>
          <div style={{ fontSize: 14 }}>{conf.mensaje}</div>
        </Modal>
      )}
    </>
  );
}
