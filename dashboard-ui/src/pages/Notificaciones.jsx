import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Tabs, Button, TextInput, Textarea, Select, Radio, Group, Switch, NumberInput } from '@mantine/core';
import { api } from '../api';
import { fdate, soloTelefono } from '../lib/format';
import { confirmar, toastErr } from '../lib/ui';
import { Emoji, useTextoEmoji } from '../context/EmojiContext';

// Inserta texto en la posición del cursor (no al final) del <textarea> nativo
// detrás de un Mantine Textarea -- Mantine reenvía el ref al elemento DOM real.
function insertarEnCursor(ref, valorActual, setValor, textoInsertar) {
  const el = ref.current;
  if (!el) { setValor(valorActual + textoInsertar); return; }
  const inicio = el.selectionStart ?? valorActual.length;
  const fin = el.selectionEnd ?? valorActual.length;
  const nuevo = valorActual.slice(0, inicio) + textoInsertar + valorActual.slice(fin);
  setValor(nuevo);
  requestAnimationFrame(() => {
    el.focus();
    const pos = inicio + textoInsertar.length;
    el.setSelectionRange(pos, pos);
  });
}

const PLANTILLAS_IND = {
  pedido_listo: 'Hola {nombre} \n\nTe informamos que tu pedido está listo para enviarse. En breve recibirás tu guía de rastreo. ¡Gracias por tu compra! ',
  guia_generada: 'Hola {nombre} \n\nTu pedido ya está en camino. Puedes rastrear tu envío en la página de Estafeta. ¡Que lo disfrutes! ',
  pago_pendiente: 'Hola {nombre} \n\nRecordamos que tienes un pago pendiente. ¿Necesitas ayuda? Responde este mensaje.',
  seguimiento: 'Hola {nombre} \n\n¿Cómo estás? Queremos saber si todo llegó bien con tu pedido. ',
};

const PLANTILLAS_MAS = {
  promocion: 'Hola {nombre} \n\nTenemos ofertas especiales esta semana en Julio Cepeda Jugueterías. ¡Escríbenos para conocer los descuentos! ',
  reactivacion: 'Hola {nombre} \n\n¡Hace tiempo no nos visitas! Te extrañamos. Tenemos productos nuevos que te van a encantar. ',
  novedad: 'Hola {nombre} \n\nAcabamos de recibir productos nuevos que creemos te van a interesar. Escríbenos para verlos. ',
};

function capitalizar(nombre) {
  return nombre ? nombre.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : 'Sin nombre';
}

export default function Notificaciones() {
  const txt = useTextoEmoji();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState('individual');

  // Individual
  const [filtro, setFiltro] = useState('');
  const [clienteSel, setClienteSel] = useState(null);
  const [msgInd, setMsgInd] = useState('');
  const [respInd, setRespInd] = useState(null);
  const [msgReanudar, setMsgReanudar] = useState(null);

  // POS
  const [posQ, setPosQ] = useState('');
  const [posResultados, setPosResultados] = useState([]);
  const [posCarrito, setPosCarrito] = useState([]);
  const [respPos, setRespPos] = useState(null);

  // Masivo
  const [audienciaTipo, setAudienciaTipo] = useState('todos');
  const [limM, setLimM] = useState(50);
  const [msgMasivo, setMsgMasivo] = useState('');
  const [codigoCampana, setCodigoCampana] = useState('');
  const [waLink, setWaLink] = useState('');
  const [cuando, setCuando] = useState('ahora');
  const [fechaProg, setFechaProg] = useState('');
  const [respMasivo, setRespMasivo] = useState(null);

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => api.get('/api/clientes'),
  });

  // Cupones activos -- para insertar el código en el mensaje sin tener que
  // ir a copiarlo manualmente desde la página de Cupones.
  const { data: cuponesActivos = [] } = useQuery({
    queryKey: ['promociones', '1'],
    queryFn: () => api.get('/api/promociones?activa=1'),
  });
  const [cuponSelInd, setCuponSelInd] = useState(null);
  const [cuponSelMas, setCuponSelMas] = useState(null);
  const refMsgInd = useRef(null);
  const refMsgMasivo = useRef(null);
  const insertarCuponInd = () => {
    if (!cuponSelInd) return;
    insertarEnCursor(refMsgInd, msgInd, setMsgInd, cuponSelInd);
    setCuponSelInd(null);
  };
  const insertarCuponMasivo = () => {
    if (!cuponSelMas) return;
    insertarEnCursor(refMsgMasivo, msgMasivo, setMsgMasivo, cuponSelMas);
    setCuponSelMas(null);
  };

  // clienteSel?.id como parte de la queryKey es lo que resuelve el bug ya
  // documentado en la auditoría: antes, si se seleccionaba otro cliente
  // mientras la respuesta de mensajes del cliente anterior seguía en vuelo,
  // ese closure obsoleto podía pintar el hilo viejo encima del cliente nuevo.
  // Con queryKey distinta por cliente, TanStack Query nunca aplica una
  // respuesta vieja a la query actual.
  // refetchInterval corto: convierte el hilo de "se actualiza si recargas la
  // página" a chat en vivo de verdad -- pensado para cuando un asesor toma
  // un caso desde Cola de Atención (botón Chatear) y necesita ver respuestas
  // del cliente sin estar dándole F5.
  const { data: hilo } = useQuery({
    queryKey: ['mensajes-cliente', clienteSel?.id],
    queryFn: () => api.get(`/api/clientes/${clienteSel.id}/mensajes`),
    enabled: !!clienteSel,
    refetchInterval: 5000,
  });

  // ?cliente=<id> en la URL (llega desde el botón "Chatear" de Cola de
  // Atención) preselecciona ese cliente en cuanto carga la lista completa.
  useEffect(() => {
    const idParam = searchParams.get('cliente');
    if (!idParam || !clientes.length) return;
    const c = clientes.find(cl => String(cl.id) === idParam);
    if (c) { setTab('individual'); setClienteSel(c); }
    setSearchParams(prev => { prev.delete('cliente'); return prev; }, { replace: true });
  }, [searchParams, clientes]);

  // "Regresar al bot": el asesor humano termina su parte y reanuda el flujo
  // automático justo en el paso que necesita confirmación de dirección o
  // generación del link de pago, en vez de dejar al cliente colgado con un
  // bot que sigue pensando que sigue ASESOR. Ver PUT /api/clientes/:id/
  // reanudar-bot (dashboard/routes/atencionCliente.js) y migrations/
  // 0010_sesiones_bot_version.sql (el bot detecta este cambio en su
  // siguiente mensaje, no hasta 30 min después).
  const reanudarBotMutation = useMutation({
    mutationFn: (paso) => api.put(`/api/clientes/${clienteSel.id}/reanudar-bot`, { paso }),
    onSuccess: (r) => {
      if (r.ok) setMsgReanudar({ ok: true, texto: 'Conversación regresada al bot (' + r.paso + ')' });
      else setMsgReanudar({ ok: false, texto: '' + r.error });
    },
    onError: (e) => setMsgReanudar({ ok: false, texto: '' + e.message }),
  });
  const reanudarBot = (paso) => {
    if (!clienteSel) return;
    setMsgReanudar(null);
    reanudarBotMutation.mutate(paso);
  };

  const { data: audiencia } = useQuery({
    queryKey: ['audiencia-masivo', audienciaTipo, limM],
    queryFn: () => {
      const params = new URLSearchParams({ limite: limM });
      if (audienciaTipo === 'conPedido') params.set('soloConPedido', '1');
      if (audienciaTipo === 'recurrentes') params.set('soloTags', 'cliente_recurrente');
      if (audienciaTipo === 'sinActividad') params.set('sinActividad', '1');
      return api.get('/api/masivo/preview?' + params.toString()).then(r => (r.ok ? r.clientes : []));
    },
    enabled: tab === 'masivo',
  });

  const listaFiltrada = clientes.filter(c =>
    !filtro || (c.nombre || '').toLowerCase().includes(filtro.toLowerCase()) || (c.telefono || '').includes(filtro)
  );

  const usarPlantilla = (tipo) => {
    const nombre = clienteSel ? capitalizar((clienteSel.nombre || '').split(' ')[0]) : '{nombre}';
    setMsgInd(PLANTILLAS_IND[tipo].replace('{nombre}', nombre));
  };

  const enviarIndMutation = useMutation({
    mutationFn: () => api.post('/api/notificar', { telefono: clienteSel.telefono, mensaje: msgInd }),
    onSuccess: (r) => {
      if (r.ok) {
        setRespInd({ ok: true, texto: 'Enviado a ' + capitalizar(clienteSel.nombre) });
        setMsgInd('');
        queryClient.invalidateQueries({ queryKey: ['mensajes-cliente', clienteSel.id] });
      } else setRespInd({ ok: false, texto: '' + r.error });
    },
    onError: (e) => setRespInd({ ok: false, texto: '' + e.message }),
  });
  const enviarIndividual = () => {
    if (!clienteSel) { setRespInd({ ok: false, texto: 'Selecciona un cliente' }); return; }
    if (!msgInd.trim()) { setRespInd({ ok: false, texto: 'Escribe el mensaje' }); return; }
    enviarIndMutation.mutate();
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

  const enviarPosMutation = useMutation({
    mutationFn: () => {
      const items = posCarrito.map(it => ({ id_producto: it.id_producto, cantidad: it.cantidad }));
      return api.post('/api/pos/venta-previa', { telefono: clienteSel.telefono, items });
    },
    onSuccess: (r) => {
      if (r.ok) {
        setRespPos({ ok: true, texto: 'Venta previa enviada (folio ' + r.folio + ')' });
        setPosCarrito([]); setPosResultados([]); setPosQ('');
      } else setRespPos({ ok: false, texto: '' + r.error });
    },
    onError: (e) => setRespPos({ ok: false, texto: '' + e.message }),
  });
  const enviarVentaPrevia = () => {
    if (!clienteSel) { setRespPos({ ok: false, texto: 'Selecciona un cliente' }); return; }
    if (!posCarrito.length) { setRespPos({ ok: false, texto: 'Agrega al menos un producto' }); return; }
    enviarPosMutation.mutate();
  };

  const usarPlantillaMasiva = (tipo) => setMsgMasivo(PLANTILLAS_MAS[tipo]);

  // Cupón flash: solo tiene sentido con envío inmediato -- la ventana de
  // validez arranca "desde el envío", y para un broadcast programado eso
  // sería desde que se llama esta API (ahora), no desde que el cron lo
  // dispare después. Por eso se oculta si cuando==='programar'.
  const [cuponFlash, setCuponFlash] = useState(false);
  const [flashCodigo, setFlashCodigo] = useState('');
  const [flashValor, setFlashValor] = useState('');
  const [flashMinutos, setFlashMinutos] = useState('10');
  const [flashUsosMax, setFlashUsosMax] = useState('10');

  const toggleProgramar = (on) => {
    setCuando(on ? 'programar' : 'ahora');
    if (on && !fechaProg) {
      const min = new Date(Date.now() + 5 * 60000);
      const pad = n => String(n).padStart(2, '0');
      setFechaProg(`${min.getFullYear()}-${pad(min.getMonth() + 1)}-${pad(min.getDate())}T${pad(min.getHours())}:${pad(min.getMinutes())}`);
    }
  };

  const enviarMasivoMutation = useMutation({
    mutationFn: (body) => api.post('/api/masivo', body),
    onSuccess: (r) => {
      if (r.ok) {
        setRespMasivo({ ok: true, texto: r.programado ? `${r.encolados} mensajes programados para ${new Date(r.enviar_en).toLocaleString('es-MX')}` : `${r.encolados} mensajes encolados` });
        setMsgMasivo('');
        setCuando('ahora');
        queryClient.invalidateQueries({ queryKey: ['audiencia-masivo'] });
      } else setRespMasivo({ ok: false, texto: '' + r.error });
    },
    onError: (e) => setRespMasivo({ ok: false, texto: '' + e.message }),
  });
  const enviarMasivo = async () => {
    if (!msgMasivo.trim()) { setRespMasivo({ ok: false, texto: 'Escribe el mensaje primero' }); return; }
    if (!audiencia?.length) { setRespMasivo({ ok: false, texto: 'Actualiza la audiencia primero' }); return; }
    let enviarEn = null;
    if (cuando === 'programar') {
      if (!fechaProg) { setRespMasivo({ ok: false, texto: 'Selecciona fecha y hora' }); return; }
      enviarEn = new Date(fechaProg).toISOString();
      if (new Date(enviarEn) <= new Date()) { setRespMasivo({ ok: false, texto: 'La hora ya pasó' }); return; }
    }
    if (cuponFlash) {
      if (!flashCodigo.trim() || !flashValor) { setRespMasivo({ ok: false, texto: 'Completa código y valor del cupón flash' }); return; }
    }
    const confirmTxt = enviarEn
      ? `¿Programar para ${new Date(enviarEn).toLocaleString('es-MX')} a ${audiencia.length} clientes?`
      : `¿Enviar a ${audiencia.length} clientes ahora?`;
    if (!await confirmar({ mensaje: confirmTxt, textoOk: 'Enviar' })) return;

    let mensajeFinal = msgMasivo;
    if (cuponFlash) {
      try {
        const r = await api.post('/api/promociones/flash', {
          codigo: flashCodigo, tipo: 'porcentaje', valor: parseFloat(flashValor),
          minutos_validez: parseInt(flashMinutos || 10), usos_max: parseInt(flashUsosMax || 10),
        });
        if (!r.ok) { setRespMasivo({ ok: false, texto: 'Cupón flash: ' + r.error }); return; }
        if (!mensajeFinal.includes(r.codigo)) mensajeFinal += `\n\nUsa el código ${r.codigo} — válido solo por ${flashMinutos} minutos.`;
      } catch (e) { setRespMasivo({ ok: false, texto: 'Cupón flash: ' + e.message }); return; }
    }

    enviarMasivoMutation.mutate({
      mensaje: mensajeFinal, limite: limM, enviarEn,
      codigo_campana: codigoCampana || undefined,
      soloConPedido: audienciaTipo === 'conPedido',
      soloTags: audienciaTipo === 'recurrentes' ? ['cliente_recurrente'] : [],
      sinActividad: audienciaTipo === 'sinActividad',
    });
  };

  return (
    <div>
      <div className="page-title">Operación diaria</div>
      <div className="page-sub">Chat en vivo, venta previa y campañas masivas</div>

      <Tabs value={tab} onChange={setTab} mb="md">
        <Tabs.List>
          <Tabs.Tab value="individual">{txt('👤 Individual')}</Tabs.Tab>
          <Tabs.Tab value="masivo">{txt('📣 Masivo')}</Tabs.Tab>
        </Tabs.List>
      </Tabs>

      {tab === 'individual' && (
        <div className="split-2">
          <Card withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{txt('👥 Seleccionar cliente')}</div>
              <TextInput placeholder="Buscar nombre o teléfono..." value={filtro} onChange={e => setFiltro(e.target.value)} />
            </div>
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {listaFiltrada.length === 0 && <div className="empty">Sin resultados</div>}
              {listaFiltrada.map(c => {
                const sel = clienteSel?.id === c.id;
                return (
                  <div key={c.id} onClick={() => setClienteSel(c)} style={{
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
          </Card>

          <Card withBorder radius="md" p="lg">
            <div style={{ padding: 10, background: 'var(--panel-2)', borderRadius: 7, marginBottom: 12, minHeight: 50, display: 'flex', alignItems: 'center' }}>
              {!clienteSel && <span style={{ color: 'var(--text-mute)', fontSize: 13 }}>Selecciona un cliente</span>}
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
                        <Emoji></Emoji>{clienteSel.codigo_referido}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {clienteSel && (
              <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 7, padding: 8, marginBottom: 12 }}>
                {hilo === undefined && <div className="text-muted" style={{ fontSize: 12 }}>Cargando conversación...</div>}
                {hilo?.length === 0 && <div className="text-muted" style={{ fontSize: 12 }}>Sin mensajes registrados todavía.</div>}
                {hilo?.map((m, i) => {
                  const dcha = m.rol === 'bot' || m.rol === 'asesor';
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: dcha ? 'flex-end' : 'flex-start', marginBottom: 6 }}>
                      <div className={`chat-burbuja rol-${m.rol}`}>
                        <div>{m.contenido}</div>
                        <div className="chat-meta">{m.rol} · {fdate(m.enviado_en)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {clienteSel && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', marginBottom: 6, textTransform: 'uppercase' }}>Regresar al bot</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  <Button variant="light" size="xs" disabled={reanudarBotMutation.isPending} onClick={() => reanudarBot('confirmar_direccion')}>
                    {txt('📮 Pedir confirmación de dirección')}
                  </Button>
                  <Button variant="light" size="xs" disabled={reanudarBotMutation.isPending} onClick={() => reanudarBot('generar_pago')}>
                    {txt('💳 Generar/reenviar link de pago')}
                  </Button>
                </div>
                {msgReanudar && <div className={msgReanudar.ok ? 'card' : 'login-error'} style={{ marginTop: 8, fontSize: 12 }}>{txt(msgReanudar.texto)}</div>}
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', marginBottom: 6, textTransform: 'uppercase' }}>Plantillas</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                <Button variant="default" size="xs" onClick={() => usarPlantilla('pedido_listo')}>{txt('📦 Pedido listo')}</Button>
                <Button variant="default" size="xs" onClick={() => usarPlantilla('guia_generada')}>{txt('🚚 Guía lista')}</Button>
                <Button variant="default" size="xs" onClick={() => usarPlantilla('pago_pendiente')}>{txt('💳 Pago pendiente')}</Button>
                <Button variant="default" size="xs" onClick={() => usarPlantilla('seguimiento')}>{txt('👋 Seguimiento')}</Button>
              </div>
            </div>
            <Textarea ref={refMsgInd} label="Mensaje" value={msgInd} onChange={e => setMsgInd(e.target.value)} placeholder="Escribe o elige una plantilla..." minRows={4} mb="sm" />
            {cuponesActivos.length > 0 && (
              <Group gap={6} mb="sm" wrap="nowrap">
                <Select
                  placeholder="Insertar código de cupón..." size="xs" style={{ flex: 1 }}
                  data={cuponesActivos.map(c => ({ value: c.codigo, label: `${c.codigo} (${c.tipo === 'porcentaje' ? c.valor + '%' : '$' + c.valor})` }))}
                  value={cuponSelInd} onChange={setCuponSelInd} comboboxProps={{ withinPortal: true }} searchable
                />
                <Button variant="default" size="xs" disabled={!cuponSelInd} onClick={insertarCuponInd}>Insertar</Button>
              </Group>
            )}
            <Button fullWidth disabled={enviarIndMutation.isPending} onClick={enviarIndividual}>{txt('📤 Enviar por WhatsApp')}</Button>
            {respInd && <div className={respInd.ok ? 'card' : 'login-error'} style={{ marginTop: 12 }}>{txt(respInd.texto)}</div>}

            <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', marginBottom: 6, textTransform: 'uppercase' }}>{txt('🛒 Venta previa (POS)')}</div>
              <Group gap={6} mb={8} wrap="nowrap">
                <TextInput placeholder="Buscar producto..." value={posQ} onChange={e => setPosQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && buscarProductoPOS()} style={{ flex: 1 }} />
                <Button variant="default" size="xs" onClick={buscarProductoPOS}>Buscar</Button>
              </Group>
              <div style={{ maxHeight: 140, overflowY: 'auto', marginBottom: 8 }}>
                {posResultados.length === 0 && <div className="text-muted" style={{ fontSize: 12 }}>{posQ ? 'Sin resultados.' : ''}</div>}
                {posResultados.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                    <div style={{ flex: 1 }}>{p.name} — ${Number(p.price).toFixed(2)}</div>
                    <Button variant="default" size="xs" onClick={() => agregarProductoPOS(p)}>+ Agregar</Button>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, marginBottom: 8, color: 'var(--text-mute)' }}>
                {posCarrito.length === 0 ? 'Carrito vacío' : posCarrito.map(it => (
                  <div key={it.id_producto} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                    <span style={{ flex: 1 }}>{it.nombre} ×{it.cantidad}</span>
                    <Button variant="default" size="xs" onClick={() => quitarProductoPOS(it.id_producto)}></Button>
                  </div>
                ))}
              </div>
              <Button fullWidth size="sm" disabled={enviarPosMutation.isPending} onClick={enviarVentaPrevia}>{txt('📨 Crear venta previa y enviar')}</Button>
              {respPos && <div className={respPos.ok ? 'card' : 'login-error'} style={{ marginTop: 12 }}>{txt(respPos.texto)}</div>}
            </div>
          </Card>
        </div>
      )}

      {tab === 'masivo' && (
        <div className="split-2">
          <Card withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{txt('🎯 Audiencia')}</div>
              <Select
                mb={7} value={audienciaTipo} onChange={v => setAudienciaTipo(v ?? audienciaTipo)} comboboxProps={{ withinPortal: true }}
                data={[
                  { value: 'todos', label: txt('👥 Todos los clientes') },
                  { value: 'conPedido', label: txt('📦 Con pedido previo') },
                  { value: 'recurrentes', label: txt('⭐ Recurrentes') },
                  { value: 'sinActividad', label: txt('😴 Sin actividad 30+ días') },
                ]}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <label style={{ fontSize: 12, color: 'var(--text-mute)', whiteSpace: 'nowrap' }}>Máx:</label>
                <TextInput type="number" value={limM} min={1} max={500} onChange={e => setLimM(parseInt(e.target.value) || 50)} w={70} size="xs" />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-mute)' }}>
                <span>{audiencia === undefined ? 'Calculando...' : 'clientes recibirán el mensaje'}</span>
                <strong style={{ fontSize: 18, color: 'var(--accent)' }}>{audiencia === undefined ? '...' : audiencia.length}</strong>
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
          </Card>

          <Card withBorder radius="md" p="lg">
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', marginBottom: 6, textTransform: 'uppercase' }}>Plantillas</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                <Button variant="default" size="xs" onClick={() => usarPlantillaMasiva('promocion')}>{txt('🏷️ Promoción')}</Button>
                <Button variant="default" size="xs" onClick={() => usarPlantillaMasiva('reactivacion')}>{txt('👋 Reactivación')}</Button>
                <Button variant="default" size="xs" onClick={() => usarPlantillaMasiva('novedad')}>{txt('✨ Novedad')}</Button>
              </div>
            </div>
            <Textarea
              ref={refMsgMasivo}
              label={<>Mensaje <span style={{ fontWeight: 400, color: 'var(--text-mute)' }}>- usa {'{nombre}'}</span></>}
              value={msgMasivo} onChange={e => setMsgMasivo(e.target.value)} placeholder="Hola {nombre}..." minRows={5} mb="sm"
            />
            {cuponesActivos.length > 0 && (
              <Group gap={6} mb="sm" wrap="nowrap">
                <Select
                  placeholder="Insertar código de cupón..." size="xs" style={{ flex: 1 }}
                  data={cuponesActivos.map(c => ({ value: c.codigo, label: `${c.codigo} (${c.tipo === 'porcentaje' ? c.valor + '%' : '$' + c.valor})` }))}
                  value={cuponSelMas} onChange={setCuponSelMas} comboboxProps={{ withinPortal: true }} searchable
                />
                <Button variant="default" size="xs" disabled={!cuponSelMas} onClick={insertarCuponMasivo}>Insertar</Button>
              </Group>
            )}
            <div style={{ padding: '8px 12px', background: 'var(--panel-2)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--yellow)', marginBottom: 10 }}>
              {txt('⚠️ Excluidos: troll, blacklist, queja, devolucion')}
            </div>
            <div style={{ padding: 10, background: 'var(--panel-2)', borderRadius: 7, marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', marginBottom: 7, textTransform: 'uppercase' }}>{txt('⏰ Programar')}</div>
              <Radio.Group value={cuando} onChange={v => toggleProgramar(v === 'programar')}>
                <Group gap={12}>
                  <Radio value="ahora" label="Ahora" />
                  <Radio value="programar" label="Programar..." />
                </Group>
              </Radio.Group>
              {cuando === 'programar' && (
                <TextInput type="datetime-local" value={fechaProg} onChange={e => setFechaProg(e.target.value)} size="xs" mt={8} />
              )}
            </div>

            {cuando === 'ahora' && (
              <div style={{ padding: 10, background: 'var(--panel-2)', borderRadius: 7, marginBottom: 10 }}>
                <Group justify="space-between" mb={cuponFlash ? 8 : 0}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', textTransform: 'uppercase' }}>{txt('⚡ Cupón flash')}</div>
                  <Switch checked={cuponFlash} onChange={e => setCuponFlash(e.currentTarget.checked)} size="sm" />
                </Group>
                {cuponFlash && (
                  <>
                    <p className="page-sub" style={{ margin: '0 0 8px', fontSize: 12 }}>
                      Se activa justo al enviar este broadcast: válido por los minutos indicados desde
                      ahora, hasta el máximo de redenciones (tope global, no por cliente).
                    </p>
                    <Group grow mb={8}>
                      <TextInput placeholder="Código (ej: FLASH10)" size="xs" value={flashCodigo} onChange={e => setFlashCodigo(e.target.value)} />
                      <NumberInput placeholder="% descuento" size="xs" min={1} max={100} value={flashValor === '' ? '' : Number(flashValor)} onChange={v => setFlashValor(v === '' ? '' : String(v))} />
                    </Group>
                    <Group grow>
                      <NumberInput label="Minutos de validez" size="xs" min={1} max={1440} value={Number(flashMinutos)} onChange={v => setFlashMinutos(String(v ?? 10))} />
                      <NumberInput label="Máx. redenciones" size="xs" min={1} value={Number(flashUsosMax)} onChange={v => setFlashUsosMax(String(v ?? 10))} />
                    </Group>
                  </>
                )}
              </div>
            )}

            <TextInput label="Código de campaña (opcional — para medir atribución)" placeholder="ej. VERANO_IG"
              value={codigoCampana} onChange={e => setCodigoCampana(e.target.value)} mb="xs" size="xs" />
            <Group gap="xs" mb="sm">
              <Button size="xs" variant="default" onClick={async () => {
                try { const r = await api.get('/api/marketing/wa-link?campana=' + encodeURIComponent(codigoCampana || 'general'));
                  if (r.ok) { setWaLink(r.link); navigator.clipboard?.writeText(r.link); } else toastErr(r.error);
                } catch (e) { toastErr(e.message); }
              }}>Generar link wa.me para redes</Button>
              {waLink && <span style={{ fontSize: 11, color: 'var(--text-mute)', wordBreak: 'break-all' }}>Copiado: {waLink}</span>}
            </Group>
            <Button fullWidth disabled={enviarMasivoMutation.isPending} onClick={enviarMasivo}>
              <Emoji></Emoji>Enviar a {audiencia?.length || 0} clientes
            </Button>
            {respMasivo && <div className={respMasivo.ok ? 'card' : 'login-error'} style={{ marginTop: 12 }}>{txt(respMasivo.texto)}</div>}
          </Card>
        </div>
      )}
    </div>
  );
}
