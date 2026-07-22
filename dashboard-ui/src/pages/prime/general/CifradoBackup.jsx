// CifradoBackup.jsx — Cifrado de respaldos + restaurar BD (Master Password).
// Alto = la maestra no se guarda, la clave derivada se MUESTRA una vez; bajo
// = clave en la BD. Extraído de GeneralTab.jsx, sin cambios de comportamiento.
import { useEffect, useState } from 'react';
import { api } from '../../../api';
import { alertar, prompt } from '../../../lib/ui';
import { useTextoEmoji } from '../../../context/EmojiContext';

// Convierte bytes a base64 en chunks -- un spread de todo el archivo como
// argumentos de String.fromCharCode revienta con RangeError (stack overflow)
// para archivos reales de respaldo (~cientos de KB o más).
function bytesToBase64(bytes) {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function CifradoBackup() {
  const txt = useTextoEmoji();
  const [estado, setEstado] = useState(null);
  const [claveMostrada, setClaveMostrada] = useState('');
  const [msg, setMsg] = useState(null);
  useEffect(() => { api.get('/api/prime/backup-cifrado').then(setEstado).catch(() => {}); }, []);
  const setModo = async (modo) => {
    setMsg(null); setClaveMostrada('');
    let body = { modo };
    if (modo === 'alto') {
      const master = await prompt({ titulo: 'Cifrado ALTO', tipo: 'password', mensaje: 'Define tu contraseña MAESTRA (mín. 8). No se guarda: se derivará una clave que deberás APUNTAR/fotografiar.\n\n' + txt('⚠️ ') + 'Si la pierdes junto con la maestra, los respaldos serán IRRECUPERABLES.' });
      if (!master) return;
      body.master = master;
    }
    try {
      const r = await api.put('/api/prime/backup-cifrado', body);
      if (!r.ok) throw new Error(r.error);
      if (r.clave_derivada) setClaveMostrada(r.clave_derivada);
      setMsg({ ok: true, t: 'Modo: ' + r.modo });
      api.get('/api/prime/backup-cifrado').then(setEstado);
    } catch (e) { setMsg({ ok: false, t: e.message }); }
  };
  const armar = async () => {
    const master = await prompt({ titulo: 'Armar clave', tipo: 'password', mensaje: 'Ingresa la contraseña maestra para armar la clave de cifrado:' });
    if (!master) return;
    const r = await api.post('/api/prime/backup-cifrado/armar', { master });
    setMsg(r.ok ? { ok: true, t: 'Clave armada' } : { ok: false, t: r.error });
    api.get('/api/prime/backup-cifrado').then(setEstado);
  };
  const restaurar = async () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.enc,.gz,.db';
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      const password = await prompt({ titulo: 'Restaurar BD', tipo: 'password', mensaje: 'Tu contraseña de Prime:' }); if (!password) return;
      const b64 = bytesToBase64(new Uint8Array(await f.arrayBuffer()));
      let clave_hex, master;
      if (!f.name.endsWith('.gz')) {
        clave_hex = await prompt({ titulo: 'Restaurar BD', mensaje: 'Clave de descifrado (la clave_hex que apuntaste). Deja vacío para usar la contraseña maestra:' }) || undefined;
        if (!clave_hex) master = await prompt({ titulo: 'Restaurar BD', tipo: 'password', mensaje: 'Contraseña maestra:' }) || undefined;
      }
      try {
        const r = await api.post('/api/prime/restaurar-bd', { archivo_base64: b64, password, clave_hex, master });
        if (!r.ok) throw new Error(r.error);
        await alertar({ titulo: 'Restauración lista', mensaje: r.msg + '\n\nReinicia el sistema (o el bridge) para aplicar la restauración.' });
      } catch (e) { setMsg({ ok: false, t: e.message }); }
    };
    inp.click();
  };
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-header"><h3>Cifrado de respaldos y restauración</h3></div>
      <p style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 8 }}>
        Modo actual: <strong>{estado?.modo || '...'}</strong>{estado?.modo === 'alto' && !estado?.armado && ' (sin armar — ingresa la maestra)'}.
        Alto = máxima seguridad (la maestra no se guarda). Bajo = automático (clave en la base). Off = sin cifrar.
      </p>
      {estado?.modo === 'alto' && (
        <p style={{ fontSize: 12, color: 'var(--yellow)', marginBottom: 8 }}>
          {txt('⚠️ ')}En modo <strong>alto</strong> el respaldo <strong>automático</strong> (cron) no puede cifrar solo —la maestra no se guarda—, así que <strong>no se envía</strong> y te avisa por correo. Para respaldos cifrados automáticos usa el <strong>respaldo manual</strong> desde aquí, o cambia a modo <strong>bajo</strong>.
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => setModo('off')}>Sin cifrar</button>
        <button className="btn" onClick={() => setModo('bajo')}>Cifrado básico</button>
        <button className="btn btn-primary" onClick={() => setModo('alto')}>Cifrado alto (maestra)</button>
        {estado?.modo === 'alto' && !estado?.armado && <button className="btn" onClick={armar}>Armar clave</button>}
        <button className="btn" style={{ borderColor: 'var(--yellow)' }} onClick={restaurar}>Restaurar base de datos…</button>
      </div>
      {claveMostrada && (
        <div style={{ marginTop: 10, padding: 10, border: '2px solid var(--red)', borderRadius: 'var(--radius)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)' }}>APUNTA O FOTOGRAFÍA ESTA CLAVE — no se vuelve a mostrar:</div>
          <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{claveMostrada}</code>
        </div>
      )}
      {msg && <p style={{ fontSize: 12, marginTop: 8, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.t}</p>}
    </div>
  );
}
