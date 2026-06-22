import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [recordar, setRecordar] = useState(false);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setCargando(true);
    try {
      await login(username, password, recordar);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">Julio Cepeda</div>
        <div className="login-sub">Panel de operaciones — inicia sesión para continuar</div>
        {error && <div className="login-error">{error}</div>}
        <div className="login-field">
          <label>Usuario</label>
          <input value={username} onChange={e => setUsername(e.target.value)} autoFocus required />
        </div>
        <div className="login-field">
          <label>Contraseña</label>
          <div style={{ position: 'relative' }}>
            <input
              type={verPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={{ width: '100%', paddingRight: 36, boxSizing: 'border-box' }}
            />
            <button
              type="button"
              onClick={() => setVerPassword(v => !v)}
              title={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              style={{
                position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 4,
              }}
            >
              {verPassword ? '🙈' : '👁️'}
            </button>
          </div>
        </div>
        <div className="login-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            id="login-recordar"
            checked={recordar}
            onChange={e => setRecordar(e.target.checked)}
            style={{ width: 'auto' }}
          />
          <label htmlFor="login-recordar" style={{ margin: 0, cursor: 'pointer' }}>Recordar sesión (30 días)</label>
        </div>
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={cargando}>
          {cargando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
