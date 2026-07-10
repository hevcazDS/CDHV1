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

// Info modal de un solo botón — reemplaza window.alert (multilínea).
export function alertar({ titulo = 'Aviso', mensaje }) {
  return new Promise((resolve) => {
    bus.dispatchEvent(new CustomEvent('confirm', { detail: { titulo, mensaje, textoOk: 'OK', soloOk: true, resolve } }));
  });
}

// Pide un dato — reemplaza window.prompt. tipo: 'text'|'password'; si hay
// opciones, muestra un select. Resuelve al valor (string) o null si cancela.
export function prompt({ titulo = 'Dato', mensaje = '', valorInicial = '', tipo = 'text', opciones = null, textoOk = 'Aceptar' }) {
  return new Promise((resolve) => {
    bus.dispatchEvent(new CustomEvent('prompt', { detail: { titulo, mensaje, valorInicial, tipo, opciones, textoOk, resolve } }));
  });
}

// Montar UNA vez en App (junto al Layout).
export function UiHost() {
  const [toasts, setToasts] = useState([]);
  const [conf, setConf] = useState(null);
  const [prm, setPrm] = useState(null);
  const [prmVal, setPrmVal] = useState('');

  useEffect(() => {
    const onToast = (e) => {
      const id = Date.now() + Math.random();
      setToasts(t => [...t, { id, ...e.detail }]);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), e.detail.tipo === 'err' ? 4000 : 2500);
    };
    const onConfirm = (e) => setConf(e.detail);
    const onPrompt = (e) => { setPrm(e.detail); setPrmVal(e.detail.valorInicial || ''); };
    bus.addEventListener('toast', onToast);
    bus.addEventListener('confirm', onConfirm);
    bus.addEventListener('prompt', onPrompt);
    return () => { bus.removeEventListener('toast', onToast); bus.removeEventListener('confirm', onConfirm); bus.removeEventListener('prompt', onPrompt); };
  }, []);

  const cerrar = (val) => { if (conf) { conf.resolve(val); setConf(null); } };
  const cerrarPrm = (val) => { if (prm) { prm.resolve(val); setPrm(null); } };

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
          actions={conf.soloOk
            ? <button className="btn btn-primary" onClick={() => cerrar(true)}>{conf.textoOk}</button>
            : <>
              <button className="btn" onClick={() => cerrar(false)}>Cancelar</button>
              <button className={'btn ' + (conf.peligro ? 'btn-danger' : 'btn-primary')} onClick={() => cerrar(true)}>{conf.textoOk}</button>
            </>}>
          <div style={{ fontSize: 14, whiteSpace: 'pre-line' }}>{conf.mensaje}</div>
        </Modal>
      )}
      {prm && (
        <Modal title={prm.titulo} onClose={() => cerrarPrm(null)}
          actions={<>
            <button className="btn" onClick={() => cerrarPrm(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={() => cerrarPrm(prmVal)}>{prm.textoOk}</button>
          </>}>
          {prm.mensaje && <div style={{ fontSize: 13, marginBottom: 10, whiteSpace: 'pre-line' }}>{prm.mensaje}</div>}
          {prm.opciones
            ? <select className="input" value={prmVal} onChange={e => setPrmVal(e.target.value)} autoFocus style={{ width: '100%' }}>
                {prm.opciones.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
              </select>
            : <input className="input" type={prm.tipo === 'password' ? 'password' : 'text'} value={prmVal} autoFocus
                onChange={e => setPrmVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') cerrarPrm(prmVal); }}
                style={{ width: '100%' }} />}
        </Modal>
      )}
    </>
  );
}
