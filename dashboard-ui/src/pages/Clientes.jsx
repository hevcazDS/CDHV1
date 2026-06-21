import { useEffect, useState } from 'react';
import { api } from '../api';
import { fdate, soloTelefono } from '../lib/format';
import { useTextoEmoji } from '../context/EmojiContext';

function capitalizar(nombre) {
  return nombre ? nombre.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : '-';
}

export default function Clientes() {
  const txt = useTextoEmoji();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  const cargar = (texto) => {
    api.get('/api/clientes?q=' + encodeURIComponent(texto ?? q)).then(setRows).catch(e => setError(e.message));
  };
  useEffect(() => { cargar(''); }, []);

  return (
    <div>
      <div className="page-title">Clientes</div>
      <div className="page-sub">Clientes registrados vía WhatsApp</div>
      {error && <div className="login-error">No se pudieron cargar los clientes: {error}</div>}

      <div className="card">
        <div className="card-header">
          <h3>{txt('👥 Clientes')}</h3>
          <div className="actions">
            <input
              placeholder="Buscar..."
              value={q}
              onChange={e => { setQ(e.target.value); cargar(e.target.value); }}
              style={{ width: 200 }}
            />
            <button className="btn btn-secondary btn-sm" onClick={() => cargar()}>🔄</button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nombre</th><th>Teléfono</th><th>Canal</th><th>Cód. referido</th><th>Tags</th><th>Registro</th></tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan={6} className="empty">Cargando...</td></tr>}
              {rows?.length === 0 && <tr><td colSpan={6} className="empty">Sin clientes</td></tr>}
              {rows?.map(r => (
                <tr key={r.id}>
                  <td><strong>{capitalizar(r.nombre)}</strong></td>
                  <td><code style={{ fontSize: 11 }}>{soloTelefono(r.telefono)}</code></td>
                  <td>{r.canal_origen || 'whatsapp'}</td>
                  <td><code style={{ fontSize: 11 }}>{r.codigo_referido || '-'}</code></td>
                  <td>{(r.tags || '').split(',').filter(Boolean).map(t => <span className="chip" key={t}>{t.trim()}</span>)}</td>
                  <td className="text-muted">{fdate(r.creado_en)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
