import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

// Alta desde cero de un negocio nuevo (first-run). Se muestra cuando la
// instancia todavía no está configurada (GET /api/onboarding/estado →
// configurado:false). Tras guardar, inicia sesión con el admin recién creado.
export default function Onboarding({ estado }) {
  const { login } = useAuth();
  const giros = estado?.giros || [];
  const metodos = estado?.metodos || [];

  const [nombre, setNombre] = useState('');
  const [nombreCorto, setNombreCorto] = useState('');
  const [giro, setGiro] = useState(giros[0]?.clave || 'retail');
  const [moneda, setMoneda] = useState('MXN');
  const [iva, setIva] = useState('16');
  const [tono, setTono] = useState('C');
  const [metodosSel, setMetodosSel] = useState(() => metodos.map(m => m.id));
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [verPass, setVerPass] = useState(false);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const toggleMetodo = (id) =>
    setMetodosSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!nombre.trim()) return setError('Pon el nombre del negocio');
    if (!usuario.trim() || password.length < 8) return setError('Usuario y contraseña (mínimo 8 caracteres)');
    setCargando(true);
    try {
      await api.post('/api/onboarding', {
        nombre_negocio: nombre.trim(),
        nombre_negocio_corto: nombreCorto.trim() || nombre.trim(),
        giro, moneda, iva_pct: iva, tono,
        metodos_pago: metodosSel,
        admin_username: usuario.trim(),
        admin_password: password,
      });
      // Entrar con el admin recién creado
      await login(usuario.trim(), password, false);
    } catch (err) {
      setError(err.message);
      setCargando(false);
    }
  };

  const TONOS = [
    { id: 'A', label: 'Formal' },
    { id: 'B', label: 'Casual' },
    { id: 'C', label: 'Amigable' },
    { id: 'D', label: 'Ventas' },
  ];

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit} style={{ maxWidth: 460, width: '100%' }}>
        <div className="login-logo">Configura tu negocio</div>
        <div className="login-sub">Primer arranque — deja todo listo en un minuto</div>
        {error && <div className="login-error">{error}</div>}

        <div className="login-field">
          <label>Nombre del negocio *</label>
          <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej. Tacos El Güero" autoFocus required />
        </div>
        <div className="login-field">
          <label>Nombre corto (opcional)</label>
          <input value={nombreCorto} onChange={e => setNombreCorto(e.target.value)} placeholder="Ej. El Güero" />
        </div>

        <div className="login-field">
          <label>Giro del negocio *</label>
          <select value={giro} onChange={e => setGiro(e.target.value)}>
            {giros.map(g => <option key={g.clave} value={g.clave}>{g.label}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div className="login-field" style={{ flex: 1 }}>
            <label>Moneda</label>
            <input value={moneda} onChange={e => setMoneda(e.target.value)} />
          </div>
          <div className="login-field" style={{ flex: 1 }}>
            <label>IVA (%)</label>
            <input value={iva} onChange={e => setIva(e.target.value.replace(/[^0-9.]/g, ''))} />
          </div>
        </div>

        <div className="login-field">
          <label>Tono del bot</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TONOS.map(t => (
              <button type="button" key={t.id} onClick={() => setTono(t.id)}
                className={'btn ' + (tono === t.id ? 'btn-primary' : '')}
                style={{ flex: '1 0 40%', justifyContent: 'center', fontSize: 13 }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="login-field">
          <label>Métodos de pago que aceptas</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {metodos.map(m => (
              <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer',
                border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px',
                background: metodosSel.includes(m.id) ? 'var(--accent-soft, rgba(80,120,255,.15))' : 'transparent' }}>
                <input type="checkbox" checked={metodosSel.includes(m.id)} onChange={() => toggleMetodo(m.id)} style={{ width: 'auto' }} />
                {m.nombre}
              </label>
            ))}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0 4px' }} />
        <div className="login-sub" style={{ marginBottom: 8 }}>Crea tu usuario administrador</div>

        <div className="login-field">
          <label>Usuario *</label>
          <input value={usuario} onChange={e => setUsuario(e.target.value)} required />
        </div>
        <div className="login-field">
          <label>Contraseña *</label>
          <div style={{ position: 'relative' }}>
            <input type={verPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
              required style={{ width: '100%', paddingRight: 36, boxSizing: 'border-box' }} />
            <button type="button" onClick={() => setVerPass(v => !v)}
              style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: 4 }}>
              {verPass ? '' : ''}
            </button>
          </div>
        </div>

        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={cargando}>
          {cargando ? 'Configurando…' : 'Crear negocio y entrar'}
        </button>
      </form>
    </div>
  );
}
