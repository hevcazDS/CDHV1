import { useEffect, useState } from 'react';
import { api } from '../api';
import { fdate, soloTelefono } from '../lib/format';
import { Emoji, useTextoEmoji } from '../context/EmojiContext';

const PLANTILLAS_IND = {
  pedido_listo: 'Hola {nombre} 👋\n\nTe informamos que tu pedido está listo para enviarse. En breve recibirás tu guía de rastreo. ¡Gracias por tu compra! 🧸',
  guia_generada: 'Hola {nombre} 🚚\n\nTu pedido ya está en camino. Puedes rastrear tu envío en la página de Estafeta. ¡Que lo disfrutes! 🎁',
  pago_pendiente: 'Hola {nombre} 💳\n\nRecordamos que tienes un pago pendiente. ¿Necesitas ayuda? Responde este mensaje.',
  seguimiento: 'Hola {nombre} 👋\n\n¿Cómo estás? Queremos saber si todo llegó bien con tu pedido. 🧸',
};

const PLANTILLAS_MAS = {
  promocion: 'Hola {nombre} 🏷️\n\nTenemos ofertas especiales esta semana en Julio Cepeda Jugueterías. ¡Escríbenos para conocer los descuentos! 🧸',
  reactivacion: 'Hola {nombre} 👋\n\n¡Hace tiempo no nos visitas! Te extrañamos. Tenemos productos nuevos que te van a encantar. 🎁',
  novedad: 'Hola {nombre} ✨\n\nAcabamos de recibir productos nuevos que creemos te van a interesar. Escríbenos para verlos. 🧸',
};

function capitalizar(nombre) {
  return nombre ? nombre.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : 'Sin nombre';
}

export default function Notificaciones() {
  const txt = useTextoEmoji();
  const [tab, setTab] = useState('individual');

  // Individual
  const [clientes, setClientes] = useState([]);
  const [filtro, setFiltro] = useState('');
  const [clienteSel, setClienteSel] = useState(null);
  const [hilo, setHilo] = useState(null);
  const [msgInd, setMsgInd] = useState('');
  const [respInd, setRespInd] = useState(null);
  const [enviandoInd, setEnviandoInd] = useState(false);

  // POS
  const [posQ, setPosQ] = useState('');
  const [posResultados, setPosResultados] = useState([]);
  const [posCarrito, setPosCarrito] = useState([]);
  const [respPos, setRespPos] = useState(null);
  const [enviandoPos, setEnviandoPos] = useState(false);

  // Masivo
  const [audienciaTipo, setAudienciaTipo] = useState('todos');
  const [limM, setLimM] = useState(50);
  const [audiencia, setAudiencia] = useState(null);
  const [msgMasivo, setMsgMasivo] = useState('');
  const [cuando, setCuando] = useState('ahora');
  const [fechaProg, setFechaProg] = useState('');
  const [respMasivo, setRespMasivo] = useState(null);
  const [enviandoMasivo, setEnviandoMasivo] = useState(false);

  useEffect(() => { api.get('/api/clientes').then(setClientes).catch(() => setClientes([])); }, []);

  const actualizarAudiencia = (tipo = audienciaTipo, lim = limM) => {
    const params = new URLSearchParams({ limite: lim });
    if (tipo === 'conPedido') params.set('soloConPedido', '1');
    if (tipo === 'recurrentes') params.set('soloTags', 'cliente_recurrente');
    if (tipo === 'sinActividad') params.set('sinActividad', '1');
    setAudiencia(null);
    api.get('/api/masivo/preview?' + params.toString())
      .then(r => setAudiencia(r.ok ? r.clientes : []))
      .catch(() => setAudiencia([]));
  };

  useEffect(() => { if (tab === 'masivo') actualizarAudiencia(); }, [tab]);

  const listaFiltrada = clientes.filter(c =>
    !filtro || (c.nombre || '').toLowerCase().includes(filtro.toLowerCase()) || (c.telefono || '').includes(filtro)
  );

  const seleccionarCliente = (cli) => {
    setClienteSel(cli);
    setHilo(null);
    api.get(`/api/clientes/${cli.id}/mensajes`).then(setHilo).catch(() => setHilo([]));
  };

  const usarPlantilla = (tipo) => {
    const nombre = clienteSel ? capitalizar((clienteSel.nombre || '').split(' ')[0]) : '{nombre}';
    setMsgInd(PLANTILLAS_IND[tipo].replace('{nombre}', nombre));
  };

  const enviarIndividual = async () => {
    if (!clienteSel) { setRespInd({ ok: false, texto: 'Selecciona un cliente' }); return; }
    if (!msgInd.trim()) { setRespInd({ ok: false, texto: 'Escribe el mensaje' }); return; }
    setEnviandoInd(true);
    try {
      const r = await api.post('/api/notificar', { telefono: clienteSel.telefono, mensaje: msgInd });
      setEnviandoInd(false);
      if (r.ok) {
        setRespInd({ ok: true, texto: '✅ Enviado a ' + capitalizar(clienteSel.nombre) });
        setMsgInd('');
        api.get(`/api/clientes/${clienteSel.id}/mensajes`).then(setHilo).catch(() => {});
      } else setRespInd({ ok: false, texto: '❌ ' + r.error });
    } catch (e) { setEnviandoInd(false); setRespInd({ ok: false, texto: '❌ ' + e.message }); }
  };

  const buscarProductoPOS = () => {
    if (!posQ.trim()) return;
    api.get('/api/pos/buscar-producto?q=' + encodeURIComponent(posQ)).then(setPosResultados).catch(() => setPosResultados([]));
  };

  const agregarProductoPOS = (p) => {
    setPosCarrito(c => {
      const existente = c.find(it => it.id_producto === p.id);
      if (existente) return c.map(it => it.id_producto === p.id ? { ...it, cantidad: it.cantidad + 1 } : it);
      return [...c, { id_producto: p.id, nombre: p.name, cantidad: 1 }];
    });
  };

  const quitarProductoPOS = (id) => setPosCarrito(c => c.filter(it => it.id_producto !== id));

  const enviarVentaPrevia = async () => {
    if (!clienteSel) { setRespPos({ ok: false, texto: 'Selecciona un cliente' }); return; }
    if (!posCarrito.length) { setRespPos({ ok: false, texto: 'Agrega al menos un producto' }); return; }
    setEnviandoPos(true);
    try {
      const items = posCarrito.map(it => ({ id_producto: it.id_producto, cantidad: it.cantidad }));
      const r = await api.post('/api/pos/venta-previa', { telefono: clienteSel.telefono, items });
      setEnviandoPos(false);
      if (r.ok) {
        setRespPos({ ok: true, texto: '✅ Venta previa enviada (folio ' + r.folio + ')' });
        setPosCarrito([]); setPosResultados([]); setPosQ('');
      } else setRespPos({ ok: false, texto: '❌ ' + r.error });
    } catch (e) { setEnviandoPos(false); setRespPos({ ok: false, texto: '❌ ' + e.message }); }
  };

  const usarPlantillaMasiva = (tipo) => setMsgMasivo(PLANTILLAS_MAS[tipo]);

  const toggleProgramar = (on) => {
    setCuando(on ? 'programar' : 'ahora');
    if (on && !fechaProg) {
      const min = new Date(Date.now() + 5 * 60000);
      const pad = n => String(n).padStart(2, '0');
      setFechaProg(`${min.getFullYear()}-${pad(min.getMonth() + 1)}-${pad(min.getDate())}T${pad(min.getHours())}:${pad(min.getMinutes())}`);
    }
  };

  const enviarMasivo = async () => {
    if (!msgMasivo.trim()) { setRespMasivo({ ok: false, texto: 'Escribe el mensaje primero' }); return; }
    if (!audiencia?.length) { setRespMasivo({ ok: false, texto: 'Actualiza la audiencia primero' }); return; }
    let enviarEn = null;
    if (cuando === 'programar') {
      if (!fechaProg) { setRespMasivo({ ok: false, texto: 'Selecciona fecha y hora' }); return; }
      enviarEn = new Date(fechaProg).toISOString();
      if (new Date(enviarEn) <= new Date()) { setRespMasivo({ ok: false, texto: 'La hora ya pasó' }); return; }
    }
    const confirmTxt = enviarEn
      ? `¿Programar para ${new Date(enviarEn).toLocaleString('es-MX')} a ${audiencia.length} clientes?`
      : `¿Enviar a ${audiencia.length} clientes ahora?`;
    if (!window.confirm(confirmTxt)) return;
    setEnviandoMasivo(true);
    try {
      const r = await api.post('/api/masivo', {
        mensaje: msgMasivo, limite: limM, enviarEn,
        soloConPedido: audienciaTipo === 'conPedido',
        soloTags: audienciaTipo === 'recurrentes' ? ['cliente_recurrente'] : [],
        sinActividad: audienciaTipo === 'sinActividad',
      });
      setEnviandoMasivo(false);
      if (r.ok) {
        setRespMasivo({ ok: true, texto: r.programado ? `✅ ${r.encolados} mensajes programados para ${new Date(r.enviar_en).toLocaleString('es-MX')}` : `✅ ${r.encolados} mensajes encolados` });
        setMsgMasivo('');
        setCuando('ahora');
        actualizarAudiencia();
      } else setRespMasivo({ ok: false, texto: '❌ ' + r.error });
    } catch (e) { setEnviandoMasivo(false); setRespMasivo({ ok: false, texto: '❌ ' + e.message }); }
  };

  return (
    <div>
      <div className="page-title">Notificaciones</div>
      <div className="page-sub">Mensajes individuales, venta previa y campañas masivas</div>

      <div className="tabs">
        <button className={`btn btn-sm ${tab === 'individual' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('individual')}>{txt('👤 Individual')}</button>
        <button className={`btn btn-sm ${tab === 'masivo' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('masivo')}>{txt('📣 Masivo')}</button>
      </div>

      {tab === 'individual' && (
        <div className="kpi-grid" style={{ gridTemplateColumns: '1fr 1.4fr' }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{txt('👥 Seleccionar cliente')}</div>
              <input placeholder="Buscar nombre o teléfono..." value={filtro} onChange={e => setFiltro(e.target.value)} />
            </div>
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {listaFiltrada.length === 0 && <div className="empty">Sin resultados</div>}
              {listaFiltrada.map(c => {
                const sel = clienteSel?.id === c.id;
                return (
                  <div key={c.id} onClick={() => seleccionarCliente(c)} style={{
                    display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', cursor: 'pointer',
                    borderBottom: '1px solid var(--border)', background: sel ? 'var(--panel-2)' : 'transparent',
                    borderLeft: `3px solid ${sel ? 'var(--accent)' : 'transparent'}`,
                  }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: sel ? 'var(--accent)' : 'var(--panel-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
                      {capitalizar(c.nombre)[0]}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: sel ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{capitalizar(c.nombre)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-mute)', fontFamily: 'monospace' }}>{soloTelefono(c.telefono).slice(0, 18)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div style={{ padding: 10, background: 'var(--panel-2)', borderRadius: 7, marginBottom: 12, minHeight: 50, display: 'flex', alignItems: 'center' }}>
              {!clienteSel && <span style={{ color: 'var(--text-mute)', fontSize: 13 }}>← Selecciona un cliente</span>}
              {clienteSel && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%' }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 14, flexShrink: 0 }}>
                    {capitalizar(clienteSel.nombre)[0]}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{capitalizar(clienteSel.nombre)}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-mute)', fontFamily: 'monospace' }}>{soloTelefono(clienteSel.telefono)}</div>
                    {clienteSel.codigo_referido && (
                      <div style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'monospace' }} title="Código de referido — puedes mencionárselo al cliente en esta venta">
                        <Emoji>🤝 </Emoji>{clienteSel.codigo_referido}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {clienteSel && (
              <div style={{ display: hilo === null || hilo?.length ? 'block' : 'block', maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 7, padding: 8, marginBottom: 12 }}>
                {hilo === null && <div className="text-muted" style={{ fontSize: 12 }}>Cargando conversación...</div>}
                {hilo?.length === 0 && <div className="text-muted" style={{ fontSize: 12 }}>Sin mensajes registrados todavía.</div>}
                {hilo?.map((m, i) => {
                  const dcha = m.rol === 'bot' || m.rol === 'asesor';
                  const bg = m.rol === 'bot' ? '#1e3a5f' : m.rol === 'asesor' ? '#16432e' : 'var(--panel-2)';
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: dcha ? 'flex-end' : 'flex-start', marginBottom: 6 }}>
                      <div style={{ maxWidth: '80%', background: bg, borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>
                        <div>{m.contenido}</div>
                        <div className="text-muted" style={{ fontSize: 10, marginTop: 2 }}>{m.rol} · {fdate(m.enviado_en)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', marginBottom: 6, textTransform: 'uppercase' }}>Plantillas</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => usarPlantilla('pedido_listo')}>{txt('📦 Pedido listo')}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => usarPlantilla('guia_generada')}>{txt('🚚 Guía lista')}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => usarPlantilla('pago_pendiente')}>{txt('💳 Pago pendiente')}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => usarPlantilla('seguimiento')}>{txt('👋 Seguimiento')}</button>
              </div>
            </div>
            <div className="login-field">
              <label>Mensaje</label>
              <textarea value={msgInd} onChange={e => setMsgInd(e.target.value)} placeholder="Escribe o elige una plantilla..." style={{ minHeight: 110, width: '100%' }} />
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} disabled={enviandoInd} onClick={enviarIndividual}>{txt('📤 Enviar por WhatsApp')}</button>
            {respInd && <div className={respInd.ok ? 'card' : 'login-error'} style={{ marginTop: 12 }}>{txt(respInd.texto)}</div>}

            <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', marginBottom: 6, textTransform: 'uppercase' }}>{txt('🛒 Venta previa (POS)')}</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input placeholder="Buscar producto..." value={posQ} onChange={e => setPosQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && buscarProductoPOS()} style={{ flex: 1 }} />
                <button className="btn btn-secondary btn-sm" onClick={buscarProductoPOS}>Buscar</button>
              </div>
              <div style={{ maxHeight: 140, overflowY: 'auto', marginBottom: 8 }}>
                {posResultados.length === 0 && <div className="text-muted" style={{ fontSize: 12 }}>{posQ ? 'Sin resultados.' : ''}</div>}
                {posResultados.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                    <div style={{ flex: 1 }}>{p.name} — ${Number(p.price).toFixed(2)}</div>
                    <button className="btn btn-secondary btn-sm" onClick={() => agregarProductoPOS(p)}>+ Agregar</button>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, marginBottom: 8, color: 'var(--text-mute)' }}>
                {posCarrito.length === 0 ? 'Carrito vacío' : posCarrito.map(it => (
                  <div key={it.id_producto} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                    <span style={{ flex: 1 }}>{it.nombre} ×{it.cantidad}</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => quitarProductoPOS(it.id_producto)}>✕</button>
                  </div>
                ))}
              </div>
              <button className="btn btn-primary btn-sm" style={{ width: '100%' }} disabled={enviandoPos} onClick={enviarVentaPrevia}>{txt('📨 Crear venta previa y enviar')}</button>
              {respPos && <div className={respPos.ok ? 'card' : 'login-error'} style={{ marginTop: 12 }}>{txt(respPos.texto)}</div>}
            </div>
          </div>
        </div>
      )}

      {tab === 'masivo' && (
        <div className="kpi-grid" style={{ gridTemplateColumns: '1fr 1.4fr' }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{txt('🎯 Audiencia')}</div>
              <select value={audienciaTipo} onChange={e => { setAudienciaTipo(e.target.value); actualizarAudiencia(e.target.value, limM); }} style={{ marginBottom: 7, width: '100%' }}>
                <option value="todos">{txt('👥 Todos los clientes')}</option>
                <option value="conPedido">{txt('📦 Con pedido previo')}</option>
                <option value="recurrentes">{txt('⭐ Recurrentes')}</option>
                <option value="sinActividad">{txt('😴 Sin actividad 30+ días')}</option>
              </select>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <label style={{ fontSize: 12, color: 'var(--text-mute)', whiteSpace: 'nowrap' }}>Máx:</label>
                <input type="number" value={limM} min={1} max={500} onChange={e => setLimM(parseInt(e.target.value) || 50)} onBlur={() => actualizarAudiencia(audienciaTipo, limM)} style={{ width: 70 }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-mute)' }}>
                <span>{audiencia === null ? 'Calculando...' : 'clientes recibirán el mensaje'}</span>
                <strong style={{ fontSize: 18, color: 'var(--accent)' }}>{audiencia === null ? '...' : audiencia.length}</strong>
              </div>
            </div>
            <div style={{ maxHeight: 350, overflowY: 'auto', fontSize: 12 }}>
              {audiencia?.length === 0 && <div className="empty">Sin clientes para esta audiencia</div>}
              {audiencia?.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{capitalizar(c.nombre)}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-mute)', fontFamily: 'monospace' }}>{soloTelefono(c.telefono).slice(0, 15)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', marginBottom: 6, textTransform: 'uppercase' }}>Plantillas</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => usarPlantillaMasiva('promocion')}>{txt('🏷️ Promoción')}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => usarPlantillaMasiva('reactivacion')}>{txt('👋 Reactivación')}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => usarPlantillaMasiva('novedad')}>{txt('✨ Novedad')}</button>
              </div>
            </div>
            <div className="login-field">
              <label>Mensaje <span style={{ fontWeight: 400, color: 'var(--text-mute)' }}>- usa {'{nombre}'}</span></label>
              <textarea value={msgMasivo} onChange={e => setMsgMasivo(e.target.value)} placeholder="Hola {nombre}..." style={{ minHeight: 120, width: '100%' }} />
            </div>
            <div style={{ padding: '8px 12px', background: 'var(--panel-2)', borderRadius: 6, fontSize: 12, color: 'var(--yellow)', marginBottom: 10 }}>
              {txt('⚠️ Excluidos: troll, blacklist, queja, devolucion')}
            </div>
            <div style={{ padding: 10, background: 'var(--panel-2)', borderRadius: 7, marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', marginBottom: 7, textTransform: 'uppercase' }}>{txt('⏰ Programar')}</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
                  <input type="radio" name="mCuando" checked={cuando === 'ahora'} onChange={() => toggleProgramar(false)} /> Ahora
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
                  <input type="radio" name="mCuando" checked={cuando === 'programar'} onChange={() => toggleProgramar(true)} /> Programar...
                </label>
              </div>
              {cuando === 'programar' && (
                <div style={{ marginTop: 8 }}>
                  <input type="datetime-local" value={fechaProg} onChange={e => setFechaProg(e.target.value)} style={{ fontSize: 12 }} />
                </div>
              )}
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} disabled={enviandoMasivo} onClick={enviarMasivo}>
              <Emoji>📣 </Emoji>Enviar a {audiencia?.length || 0} clientes
            </button>
            {respMasivo && <div className={respMasivo.ok ? 'card' : 'login-error'} style={{ marginTop: 12 }}>{txt(respMasivo.texto)}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
