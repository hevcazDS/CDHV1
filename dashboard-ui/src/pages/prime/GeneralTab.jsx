// GeneralTab.jsx — Tab "General" de Prime (soloPrime): identidad del negocio,
// envío/Estafeta, reconexión, contacto/backups, correo del bot, sucursal de
// facturación, tope de descuento y preferencia de fuente.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from '@mantine/form';
import {
  Card, Title, Group, Badge, Switch, SimpleGrid,
  TextInput, NumberInput, PasswordInput, Select, Button, Fieldset, SegmentedControl,
} from '@mantine/core';
import { api } from '../../api';
import { useTextoEmoji } from '../../context/EmojiContext';
import { guardarPreferenciasFuente } from '../../lib/fontPrefs';
import { alertar, prompt } from '../../lib/ui';

export default function GeneralTab() {
  const txt = useTextoEmoji();
  const [costoDefault, setCostoDefault] = useState('');
  const [idPedido, setIdPedido] = useState('');
  const [costoPedido, setCostoPedido] = useState('');
  const [nombreNegocio, setNombreNegocio] = useState('');
  const [diasEntrega, setDiasEntrega] = useState('');
  const [msg, setMsg] = useState('');

  const [reconexionAuto, setReconexionAuto] = useState(false);
  const [msgReconexion, setMsgReconexion] = useState('');

  const contactoForm = useForm({ initialValues: {
    operador_telefono: '', soporte_url: '', soporte_telefono: '', soporte_correo: '', email_backup_destino: '',
  } });
  const [msgContacto, setMsgContacto] = useState('');

  const [botEmailUsuario, setBotEmailUsuario] = useState('');
  const [botEmailPassword, setBotEmailPassword] = useState('');
  const [botEmailPassConfigurada, setBotEmailPassConfigurada] = useState(false);
  const [msgEmailBot, setMsgEmailBot] = useState('');

  const [topeDescuento, setTopeDescuento] = useState('');
  const [msgTope, setMsgTope] = useState('');

  const [sucursalFacturacion, setSucursalFacturacion] = useState('');
  const [msgSucursalFacturacion, setMsgSucursalFacturacion] = useState('');

  const [fuentePrefs, setFuentePrefs] = useState(() => {
    const familia = localStorage.getItem('jc-fuente-familia') || 'inter';
    const tamano = localStorage.getItem('jc-fuente-tamano') || 'normal';
    return { familia, tamano };
  });
  const guardarFuente = () => guardarPreferenciasFuente(fuentePrefs.familia, fuentePrefs.tamano);

  const { data: sucursales = [] } = useQuery({
    queryKey: ['prime-sucursales'],
    queryFn: () => api.get('/api/prime/sucursales'),
  });

  useEffect(() => {
    api.get('/api/prime/envio-default').then(d => setCostoDefault(String(d.costo_envio_default)));
    api.get('/api/prime/estafeta-dias-entrega').then(d => setDiasEntrega(String(d.dias_entrega)));
    api.get('/api/negocio').then(d => setNombreNegocio(d.nombre_negocio));
    api.get('/api/prime/config').then(d => setReconexionAuto(!!d.reconexion_auto_activo)).catch(() => {});
    api.get('/api/prime/config-contacto').then(d => contactoForm.setValues({
      operador_telefono: d.operador_telefono || '', soporte_url: d.soporte_url || '',
      soporte_telefono: d.soporte_telefono || '', soporte_correo: d.soporte_correo || '',
      email_backup_destino: d.email_backup_destino || '',
    })).catch(() => {});
    api.get('/api/prime/config-email-bot').then(d => {
      setBotEmailUsuario(d.bot_email_usuario || '');
      setBotEmailPassConfigurada(!!d.bot_email_password_configurada);
    }).catch(() => {});
    api.get('/api/prime/tope-descuento').then(d => setTopeDescuento(String(d.tope_descuento_pct))).catch(() => {});
    api.get('/api/prime/sucursal-facturacion-default').then(d => setSucursalFacturacion(d.id_sucursal ? String(d.id_sucursal) : '')).catch(() => {});
  }, []);

  const guardarDefault = async () => {
    setMsg('');
    try {
      const d = await api.put('/api/prime/envio-default', { costo_envio: Number(costoDefault) });
      setMsg(`Costo de envío default actualizado a $${d.costo_envio_default}`);
    } catch (e) { setMsg(e.message); }
  };

  const guardarDiasEntrega = async () => {
    setMsg('');
    try {
      const d = await api.put('/api/prime/estafeta-dias-entrega', { dias_entrega: Number(diasEntrega) });
      setMsg(`Días de entrega Estafeta actualizados a ${d.dias_entrega}`);
    } catch (e) { setMsg(e.message); }
  };

  const guardarNegocio = async () => {
    setMsg('');
    try {
      const d = await api.put('/api/prime/negocio', { nombre_negocio: nombreNegocio });
      setMsg(`Nombre del negocio actualizado a "${d.nombre_negocio}"`);
    } catch (e) { setMsg(e.message); }
  };

  const guardarPedido = async () => {
    setMsg('');
    try {
      const d = await api.put(`/api/prime/envio/${idPedido}`, { costo_envio: Number(costoPedido) });
      setMsg(`Pedido #${d.id_pedido} actualizado a $${d.costo_envio}`);
    } catch (e) { setMsg(e.message); }
  };

  const toggleReconexionAuto = async () => {
    setMsgReconexion('');
    const activo = !reconexionAuto;
    try {
      await api.post('/api/prime/config', { clave: 'reconexion_auto_activo', activo });
      setReconexionAuto(activo);
    } catch (e) { setMsgReconexion(e.message); }
  };

  const guardarContacto = async () => {
    setMsgContacto('');
    try {
      await api.put('/api/prime/config-contacto', contactoForm.values);
      setMsgContacto('Guardado.');
    } catch (e) { setMsgContacto(e.message); }
  };

  const guardarEmailBot = async () => {
    setMsgEmailBot('');
    try {
      const datos = { bot_email_usuario: botEmailUsuario };
      if (botEmailPassword) datos.bot_email_password = botEmailPassword;
      await api.put('/api/prime/config-email-bot', datos);
      setBotEmailPassword('');
      if (datos.bot_email_password) setBotEmailPassConfigurada(true);
      setMsgEmailBot('Guardado.');
    } catch (e) { setMsgEmailBot(e.message); }
  };

  const guardarTopeDescuento = async () => {
    setMsgTope('');
    try {
      const d = await api.put('/api/prime/tope-descuento', { tope_descuento_pct: Number(topeDescuento) });
      setMsgTope(d.tope_descuento_pct > 0 ? `Tope actualizado a ${d.tope_descuento_pct}%` : 'Sin tope — cualquier usuario admin puede crear descuentos sin límite');
    } catch (e) { setMsgTope(e.message); }
  };

  const guardarSucursalFacturacion = async () => {
    setMsgSucursalFacturacion('');
    if (!sucursalFacturacion) { setMsgSucursalFacturacion('Elige una sucursal'); return; }
    try {
      await api.put('/api/prime/sucursal-facturacion-default', { id_sucursal: Number(sucursalFacturacion) });
      setMsgSucursalFacturacion('Guardado.');
    } catch (e) { setMsgSucursalFacturacion(e.message); }
  };

  return (
    <div>
      {msg && <div className="card" style={{ marginBottom: 16 }}>{msg}</div>}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Card withBorder radius="md" p="lg">
          <Title order={4} mb={4}>Nombre del negocio</Title>
          <p className="page-sub" style={{ margin: '4px 0 16px' }}>
            Se muestra en el panel (sidebar). Útil si se revende este sistema a otra juguetería.
          </p>
          <TextInput maxLength={80} value={nombreNegocio} onChange={e => setNombreNegocio(e.target.value)} mb="sm" />
          <Button onClick={guardarNegocio}>Guardar</Button>
        </Card>

        <Card withBorder radius="md" p="lg">
          <Title order={4} mb={4}>Costo de envío default</Title>
          <p className="page-sub" style={{ margin: '4px 0 16px' }}>
            Se aplica a pedidos nuevos. No requiere un pedido específico.
          </p>
          <NumberInput min={0} value={costoDefault === '' ? '' : Number(costoDefault)} onChange={v => setCostoDefault(v === '' ? '' : String(v))} mb="sm" />
          <Button onClick={guardarDefault}>Guardar</Button>
        </Card>

        <Card withBorder radius="md" p="lg">
          <Title order={4} mb={4}>Días de entrega Estafeta</Title>
          <p className="page-sub" style={{ margin: '4px 0 16px' }}>
            Días hábiles que se suman para estimar la fecha de entrega. Sube este número en
            fechas como navidad si los pedidos se van a retrasar más de lo normal.
          </p>
          <NumberInput min={1} max={30} value={diasEntrega === '' ? '' : Number(diasEntrega)} onChange={v => setDiasEntrega(v === '' ? '' : String(v))} mb="sm" />
          <Button onClick={guardarDiasEntrega}>Guardar</Button>
        </Card>

        <Card withBorder radius="md" p="lg">
          <Title order={4} mb={4}>Reconexión automática de WhatsApp</Title>
          <p className="page-sub" style={{ margin: '4px 0 16px' }}>
            Si WhatsApp se desconecta, por defecto el bot se queda detenido hasta que alguien lo
            reinicie a mano. Activa esto si prefieres que intente reconectarse solo, a cambio de
            un riesgo pequeño de quedar con un Chrome zombie si la desconexión fue por un perfil
            corrupto.
          </p>
          {msgReconexion && <div className="login-error" style={{ marginBottom: 12 }}>{msgReconexion}</div>}
          <Group gap="sm">
            <Switch checked={reconexionAuto} onChange={toggleReconexionAuto} color="blue" />
            <Badge color={reconexionAuto ? 'teal' : 'red'} variant="light">{txt(reconexionAuto ? 'Activa' : 'Inactiva')}</Badge>
          </Group>
        </Card>

        <Card withBorder radius="md" p="lg">
          <Title order={4} mb={4}>Corregir un pedido puntual (opcional)</Title>
          <p className="page-sub" style={{ margin: '4px 0 16px' }}>
            Solo si Estafeta cotizó distinto a la simulación para un pedido ya creado.
          </p>
          <NumberInput label="ID de pedido" value={idPedido === '' ? '' : Number(idPedido)} onChange={v => setIdPedido(v === '' ? '' : String(v))} mb="sm" />
          <NumberInput label="Costo de envío" min={0} value={costoPedido === '' ? '' : Number(costoPedido)} onChange={v => setCostoPedido(v === '' ? '' : String(v))} mb="sm" />
          <Button disabled={!idPedido} onClick={guardarPedido}>Actualizar pedido</Button>
        </Card>

        <Card withBorder radius="md" p="lg">
          <Title order={4} mb={4}>Contacto y backups</Title>
          <p className="page-sub" style={{ margin: '4px 0 16px' }}>
            Teléfono del operador (antes solo en .env), contacto de soporte mostrado al cliente,
            y a qué correo(s) llegan los backups automáticos. Separa varios correos con coma.
          </p>
          {msgContacto && <div className="login-error" style={{ marginBottom: 12 }}>{msgContacto}</div>}
          <TextInput label="Teléfono del operador (WhatsApp)" placeholder="521XXXXXXXXXX" {...contactoForm.getInputProps('operador_telefono')} mb="sm" />
          <Fieldset legend="Contacto de soporte" mb="sm">
            <TextInput label="URL" placeholder="https://..." {...contactoForm.getInputProps('soporte_url')} mb="sm" />
            <Group grow>
              <TextInput label="Teléfono" {...contactoForm.getInputProps('soporte_telefono')} />
              <TextInput label="Correo" {...contactoForm.getInputProps('soporte_correo')} />
            </Group>
          </Fieldset>
          <TextInput label="Correo(s) destino de backups" placeholder="correo1@dominio.com, correo2@dominio.com" {...contactoForm.getInputProps('email_backup_destino')} mb="sm" />
          <Button onClick={guardarContacto}>Guardar</Button>
        </Card>

        <Card withBorder radius="md" p="lg">
          <Title order={4} mb={4}>Correo del bot</Title>
          <p className="page-sub" style={{ margin: '4px 0 16px' }}>
            Cuenta y contraseña de aplicación que el propio bot usa para enviar correos
            (notificaciones de pedido, backups). Útil para revender el sistema a otra empresa sin
            tocar código ni el .env del servidor. La contraseña nunca se muestra una vez guardada.
          </p>
          {msgEmailBot && <div className="login-error" style={{ marginBottom: 12 }}>{msgEmailBot}</div>}
          <TextInput label="Correo" placeholder="bot@gmail.com" value={botEmailUsuario} onChange={e => setBotEmailUsuario(e.target.value)} mb="sm" />
          <PasswordInput
            label={'Contraseña de aplicación' + (botEmailPassConfigurada ? ' (ya configurada — dejar vacío para no cambiar)' : '')}
            value={botEmailPassword} onChange={e => setBotEmailPassword(e.target.value)} mb="sm"
          />
          <Button onClick={guardarEmailBot}>Guardar</Button>
        </Card>

        <Card withBorder radius="md" p="lg">
          <Title order={4} mb={4}>Sucursal de facturación default</Title>
          <p className="page-sub" style={{ margin: '4px 0 16px' }}>
            Sucursal que se usa al dar de alta un producto nuevo (siembra el stock inicial ahí en
            vez de en las 11 sucursales) y como referencia en los tickets de venta.
          </p>
          {msgSucursalFacturacion && <div className="login-error" style={{ marginBottom: 12 }}>{msgSucursalFacturacion}</div>}
          <Select
            data={sucursales.map(s => ({ value: String(s.id), label: s.nombre }))}
            value={sucursalFacturacion} onChange={v => setSucursalFacturacion(v || '')}
            placeholder="Elige una sucursal" comboboxProps={{ withinPortal: true }} mb="sm"
          />
          <Button onClick={guardarSucursalFacturacion}>Guardar</Button>
        </Card>

        <Card withBorder radius="md" p="lg">
          <Title order={4} mb={4}>Tope de descuento en Ofertas/Cupones</Title>
          <p className="page-sub" style={{ margin: '4px 0 16px' }}>
            Límite de % de descuento que un usuario admin puede crear en Ofertas/Cupones (Fase 2).
            0 = sin tope. Solo prime puede ver/cambiar esto, y solo prime puede crear descuentos
            por encima del tope.
          </p>
          {msgTope && <div className="login-error" style={{ marginBottom: 12 }}>{msgTope}</div>}
          <NumberInput min={0} max={100} value={topeDescuento === '' ? '' : Number(topeDescuento)} onChange={v => setTopeDescuento(v === '' ? '' : String(v))} mb="sm" />
          <Button onClick={guardarTopeDescuento}>Guardar</Button>
        </Card>

        <Card withBorder radius="md" p="lg">
          <Title order={4} mb={4}>Fuente y tamaño</Title>
          <p className="page-sub" style={{ margin: '4px 0 16px' }}>
            Preferencia de este navegador (no se comparte entre operadores). Cambia esto si el
            texto se ve muy grande o se sale de las burbujas de chat.
          </p>
          <Select
            label="Familia"
            data={[
              { value: 'inter', label: 'Inter (actual)' },
              { value: 'ibmplex', label: 'IBM Plex Sans' },
              { value: 'sourcesans', label: 'Source Sans 3' },
            ]}
            value={fuentePrefs.familia}
            onChange={v => v && setFuentePrefs(p => ({ ...p, familia: v }))}
            allowDeselect={false}
            mb="sm"
          />
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 6, color: 'var(--text-dim)' }}>Tamaño</label>
            <SegmentedControl
              fullWidth
              data={[
                { value: 'pequeno', label: 'Pequeño' },
                { value: 'normal', label: 'Normal' },
                { value: 'grande', label: 'Grande' },
              ]}
              value={fuentePrefs.tamano}
              onChange={v => setFuentePrefs(p => ({ ...p, tamano: v }))}
            />
          </div>
          <Button onClick={guardarFuente}>Aplicar</Button>
        </Card>
      </SimpleGrid>
      <ZonasComisiones />
      <LinkPagoBase />
      <ZonaHoraria />
      <CifradoBackup />
      <ZonaPeligro />
    </div>
  );
}


// Zonas de cobertura (ISP/servicio local) + % de comisión por vendedor.
// CPs uno por línea; vacío = sin restricción de zona en el bot.
function ZonasComisiones() {
  const [zonas, setZonas] = useState('');
  const [pct, setPct] = useState('');
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    api.get('/api/zonas-cobertura').then(z => Array.isArray(z) && setZonas(z.map(x => x.cp).join('\n'))).catch(() => {});
    api.get('/api/comisiones').then(c => c && setPct(String(c.comision_pct ?? 0))).catch(() => {});
  }, []);
  const guardar = async () => {
    try {
      const r = await api.post('/api/zonas-cobertura', { cps: zonas.split(/\s|,|;/).filter(Boolean) });
      const r2 = await api.post('/api/comisiones/config', { pct: Number(pct) || 0 });
      if (!r.ok || !r2.ok) throw new Error(r.error || r2.error);
      setMsg({ ok: true, t: `Guardado: ${r.zonas} CP(s) de cobertura · comisión ${r2.pct}%` });
    } catch (e) { setMsg({ ok: false, t: e.message }); }
  };
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-header"><h3>Cobertura por zona y comisiones (ISP / venta por cambaceo)</h3></div>
      <p style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 10 }}>
        Si cargas CPs, el bot solo vende/agenda en esas zonas (vacío = sin restricción).
        La comisión se calcula sobre lo cobrado por cada vendedor (reporte en Métricas).
      </p>
      <textarea rows={4} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, marginBottom: 8 }}
        placeholder={'78000\n78010\n78020  (un CP por línea)'} value={zonas} onChange={e => setZonas(e.target.value)} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <label style={{ fontSize: 12 }}>Comisión por venta (%):</label>
        <input type="number" min="0" max="50" step="0.5" value={pct} onChange={e => setPct(e.target.value)} style={{ width: 80 }} />
        <button className="btn btn-primary" onClick={guardar}>Guardar</button>
        {msg && <span style={{ fontSize: 12, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.t}</span>}
      </div>
    </div>
  );
}


// Zona horaria del negocio (candado: solo Prime). Por defecto México Centro.
// Cambiarla queda en la bitácora y requiere reiniciar los procesos.
const ZONAS_MX = [
  { value: 'America/Mexico_City', label: 'Centro — CDMX, Guadalajara, Monterrey' },
  { value: 'America/Cancun', label: 'Sureste — Quintana Roo (Cancún)' },
  { value: 'America/Merida', label: 'Yucatán / Sureste (Mérida)' },
  { value: 'America/Mazatlan', label: 'Pacífico — Sinaloa, Nayarit, BCS' },
  { value: 'America/Chihuahua', label: 'Chihuahua' },
  { value: 'America/Hermosillo', label: 'Sonora (sin horario de verano)' },
  { value: 'America/Tijuana', label: 'Noroeste — Baja California (Tijuana)' },
];
function ZonaHoraria() {
  const [info, setInfo] = useState(null);
  const [zona, setZona] = useState('America/Mexico_City');
  const [msg, setMsg] = useState(null);
  useEffect(() => { api.get('/api/zona-horaria').then(r => { setInfo(r); setZona(r.configurada || r.default); }).catch(() => {}); }, []);
  const guardar = async () => {
    setMsg(null);
    const r = await api.put('/api/zona-horaria', { zona }).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) return setMsg({ ok: false, t: r.error });
    setMsg({ ok: true, t: 'Guardada. Reinicia el sistema (o el bridge) para que tome efecto.' });
    api.get('/api/zona-horaria').then(setInfo);
  };
  return (
    <Card withBorder radius="md" p="lg" className="card" style={{ marginTop: 14 }}>
      <div className="card-header"><h3>Zona horaria (solo Prime)</h3></div>
      <p style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 8 }}>
        Por defecto <strong>México Centro</strong>. El sistema siempre calcula la hora en esta zona, aunque el servidor esté en otra.
        Efectiva ahora: <strong>{info?.efectiva || '...'}</strong>. Solo Prime puede cambiarla y queda registrado quién lo hizo.
        <br />La app <strong>no puede bloquear el reloj del servidor</strong> (eso es del sistema operativo): lo <strong>vigila</strong> y registra en la bitácora si retrocede.
      </p>
      <Group align="end">
        <Select label="Zona del negocio" data={ZONAS_MX} value={zona} onChange={v => setZona(v || 'America/Mexico_City')} searchable style={{ flex: 1, maxWidth: 420 }} allowDeselect={false} />
        <Button onClick={guardar}>Guardar</Button>
      </Group>
      {msg && <p style={{ fontSize: 12, marginTop: 10, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.t}</p>}
    </Card>
  );
}

// Zona de PELIGRO (solo prime): respaldo manual, purga de sesión de WhatsApp
// (HS-503) y reset total de la instancia. Todo con confirmaciones fuertes.
function ZonaPeligro() {
  const [msg, setMsg] = useState(null);
  const correr = async (nombre, fn) => {
    try { const r = await fn(); setMsg({ ok: r.ok !== false, t: nombre + ': ' + (r.ok !== false ? (r.nota || 'listo') : r.error) }); }
    catch (e) { setMsg({ ok: false, t: nombre + ': ' + e.message }); }
  };
  const pedir = async (titulo) => {
    const password = await prompt({ titulo: 'Confirmar', mensaje: titulo + '\n\nTu contraseña de Prime:', tipo: 'password' });
    if (!password) return null;
    const confirmacion = await prompt({ titulo: 'Confirmar', mensaje: 'Escribe BORRAR para confirmar:' });
    if (confirmacion !== 'BORRAR') return null;
    return { password, confirmacion };
  };
  return (
    <div className="card" style={{ marginTop: 14, borderColor: 'var(--red)' }}>
      <div className="card-header"><h3 style={{ color: 'var(--red)' }}>Zona de peligro (solo Prime)</h3></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => correr('Respaldo', () => api.post('/api/prime/respaldo-manual'))}>
          Respaldo manual ahora
        </button>
        <button className="btn" style={{ borderColor: 'var(--yellow)' }} onClick={async () => {
          const d = await pedir('BORRAR SESIÓN DE WHATSAPP (HS-503): desvincula el número; el siguiente arranque pide QR limpio. Úsalo si el bridge quedó en conflicto.');
          if (d) correr('Purga WhatsApp', () => api.post('/api/prime/whatsapp/purgar-sesion', d));
        }}>
          Borrar sesión de WhatsApp
        </button>
        <button className="btn btn-danger" onClick={async () => {
          const d = await pedir('RESET DE INSTANCIA: borra TODA la operación (pedidos, clientes, inventario) y reabre el onboarding. Solo sobreviven los usuarios Prime.');
          if (d) correr('Reset', () => api.post('/api/prime/reset-instancia', d));
        }}>
          Resetear instancia (borrar todo)
        </button>
      </div>
      {msg && <p style={{ fontSize: 12, marginTop: 10, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.t}</p>}
    </div>
  );
}


// Cifrado de respaldos + restaurar BD (Master Password). Alto = la maestra
// no se guarda, la clave derivada se MUESTRA una vez; bajo = clave en la BD.
function CifradoBackup() {
  const [estado, setEstado] = useState(null);
  const [claveMostrada, setClaveMostrada] = useState('');
  const [msg, setMsg] = useState(null);
  useEffect(() => { api.get('/api/prime/backup-cifrado').then(setEstado).catch(() => {}); }, []);
  const setModo = async (modo) => {
    setMsg(null); setClaveMostrada('');
    let body = { modo };
    if (modo === 'alto') {
      const master = await prompt({ titulo: 'Cifrado ALTO', tipo: 'password', mensaje: 'Define tu contraseña MAESTRA (mín. 8). No se guarda: se derivará una clave que deberás APUNTAR/fotografiar.\n\n⚠️ Si la pierdes junto con la maestra, los respaldos serán IRRECUPERABLES.' });
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
      const b64 = btoa(String.fromCharCode(...new Uint8Array(await f.arrayBuffer())));
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
          ⚠️ En modo <strong>alto</strong> el respaldo <strong>automático</strong> (cron) no puede cifrar solo —la maestra no se guarda—, así que <strong>no se envía</strong> y te avisa por correo. Para respaldos cifrados automáticos usa el <strong>respaldo manual</strong> desde aquí, o cambia a modo <strong>bajo</strong>.
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
        <div style={{ marginTop: 10, padding: 10, border: '2px solid var(--red)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)' }}>APUNTA O FOTOGRAFÍA ESTA CLAVE — no se vuelve a mostrar:</div>
          <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{claveMostrada}</code>
        </div>
      )}
      {msg && <p style={{ fontSize: 12, marginTop: 8, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.t}</p>}
    </div>
  );
}


// Link de pago base del negocio (su Clip/Mercado Pago/PayPal.me) que el bot
// y el POS envían por WhatsApp cuando el módulo Link de pago está activo.
function LinkPagoBase() {
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState(null);
  useEffect(() => { api.get('/api/prime/pago-url').then(d => setUrl(d.pago_url_base || '')).catch(() => {}); }, []);
  const guardar = async () => {
    try { const r = await api.put('/api/prime/pago-url', { pago_url_base: url }); if (!r.ok) throw new Error(r.error); setMsg({ ok: true, t: 'Guardado' }); }
    catch (e) { setMsg({ ok: false, t: e.message }); }
  };
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-header"><h3>Link de pago</h3></div>
      <p style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 8 }}>
        Pega aquí tu link de cobro (Clip, Mercado Pago, PayPal.me…). El bot y el POS lo enviarán al cliente por WhatsApp con la referencia del pedido.
        Cuando integres un gateway con API, este campo se reemplaza por links dinámicos por pedido.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input type="url" placeholder="https://mpago.la/tu-link" value={url} onChange={e => setUrl(e.target.value)} style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={guardar}>Guardar</button>
      </div>
      {msg && <p style={{ fontSize: 12, marginTop: 6, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.t}</p>}
    </div>
  );
}
