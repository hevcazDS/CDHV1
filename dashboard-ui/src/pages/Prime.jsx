import { useEffect, useState } from 'react';
import { api } from '../api';
import { useTextoEmoji } from '../context/EmojiContext';

const CATEGORIAS_FILTRO = [
  { valor: 'bw_word',   etiqueta: 'Lista negra — palabra corta (match exacto)' },
  { valor: 'bw_long',   etiqueta: 'Lista negra — frase larga (substring)' },
  { valor: 'risk',      etiqueta: 'Riesgo (puntos acumulables)' },
  { valor: 'queja_l1',  etiqueta: 'Queja — nivel 1' },
  { valor: 'queja_l2',  etiqueta: 'Queja — nivel 2 (pedir humano)' },
];

export default function Prime() {
  const txt = useTextoEmoji();
  const [costoDefault, setCostoDefault] = useState('');
  const [idPedido, setIdPedido] = useState('');
  const [costoPedido, setCostoPedido] = useState('');
  const [nombreNegocio, setNombreNegocio] = useState('');
  const [diasEntrega, setDiasEntrega] = useState('');
  const [msg, setMsg] = useState('');

  // ── Reconexión automática de WhatsApp ────────────────────────────────────
  const [reconexionAuto, setReconexionAuto] = useState(false);
  const [msgReconexion, setMsgReconexion] = useState('');

  const [palabras, setPalabras] = useState([]);
  const [nuevaCategoria, setNuevaCategoria] = useState('bw_word');
  const [nuevaPalabra, setNuevaPalabra] = useState('');
  const [nuevosPuntos, setNuevosPuntos] = useState('1');
  const [msgFiltro, setMsgFiltro] = useState('');

  // ── Sucursales ──────────────────────────────────────────────────────────
  const [sucursales, setSucursales] = useState([]);
  const [nuevaSucursal, setNuevaSucursal] = useState({ nombre: '', codigo: '', direccion: '' });
  const [msgSucursales, setMsgSucursales] = useState('');

  // ── Alta de productos ──────────────────────────────────────────────────
  const PRODUCTO_VACIO = {
    name: '', cat: '', price: '', url_imagen: '', tags: '', seo_description: '',
    edad_recomendada: '', edad_min: '', genero: '',
    stock_tienda: '0', stock_cedis: '0', stock_san_luis_potosi: '0',
  };
  const [nuevoProducto, setNuevoProducto] = useState(PRODUCTO_VACIO);
  const [msgProducto, setMsgProducto] = useState('');

  // ── Usuarios del dashboard ──────────────────────────────────────────────
  const [usuarios, setUsuarios] = useState([]);
  const [nuevoUsuario, setNuevoUsuario] = useState({ username: '', password: '', rol: 'admin' });
  const [msgUsuarios, setMsgUsuarios] = useState('');

  // ── Stock mínimo por producto+sucursal ──────────────────────────────────
  const [inventarios, setInventarios] = useState([]);
  const [buscarInventario, setBuscarInventario] = useState('');
  const [editandoMinimo, setEditandoMinimo] = useState({});
  const [msgInventario, setMsgInventario] = useState('');

  const cargarPalabras = () => {
    api.get('/api/prime/palabras-filtro').then(d => setPalabras(d.items || []));
  };
  const cargarSucursales = () => {
    api.get('/api/prime/sucursales').then(setSucursales).catch(e => setMsgSucursales(e.message));
  };
  const cargarUsuarios = () => {
    api.get('/api/prime/usuarios').then(setUsuarios).catch(e => setMsgUsuarios(e.message));
  };
  const cargarInventarios = (q) => {
    const qs = q ? `?q=${encodeURIComponent(q)}` : '';
    api.get(`/api/prime/inventarios${qs}`).then(setInventarios).catch(e => setMsgInventario(e.message));
  };

  useEffect(() => {
    api.get('/api/prime/envio-default').then(d => setCostoDefault(String(d.costo_envio_default)));
    api.get('/api/prime/estafeta-dias-entrega').then(d => setDiasEntrega(String(d.dias_entrega)));
    api.get('/api/negocio').then(d => setNombreNegocio(d.nombre_negocio));
    api.get('/api/prime/config').then(d => setReconexionAuto(!!d.reconexion_auto_activo)).catch(() => {});
    cargarPalabras();
    cargarSucursales();
    cargarUsuarios();
    cargarInventarios();
  }, []);

  const toggleReconexionAuto = async () => {
    setMsgReconexion('');
    const activo = !reconexionAuto;
    try {
      await api.post('/api/prime/config', { clave: 'reconexion_auto_activo', activo });
      setReconexionAuto(activo);
    } catch (e) { setMsgReconexion(e.message); }
  };

  const crearSucursal = async () => {
    setMsgSucursales('');
    try {
      await api.post('/api/prime/sucursales', {
        nombre: nuevaSucursal.nombre,
        codigo: nuevaSucursal.codigo || undefined,
        direccion: nuevaSucursal.direccion || undefined,
      });
      setNuevaSucursal({ nombre: '', codigo: '', direccion: '' });
      cargarSucursales();
    } catch (e) { setMsgSucursales(e.message); }
  };

  const toggleSucursal = async (id, activa) => {
    try { await api.put(`/api/prime/sucursales/${id}`, { activa }); cargarSucursales(); }
    catch (e) { setMsgSucursales(e.message); }
  };

  const borrarSucursal = async (id) => {
    try { await api.del(`/api/prime/sucursales/${id}`); cargarSucursales(); }
    catch (e) { setMsgSucursales(e.message); }
  };

  const crearProducto = async () => {
    setMsgProducto('');
    if (!nuevoProducto.name.trim() || !nuevoProducto.price) {
      setMsgProducto('Nombre y precio son obligatorios.');
      return;
    }
    try {
      await api.post('/api/prime/productos', {
        ...nuevoProducto,
        price: Number(nuevoProducto.price),
        edad_min: nuevoProducto.edad_min ? Number(nuevoProducto.edad_min) : undefined,
        stock_tienda: Number(nuevoProducto.stock_tienda || 0),
        stock_cedis: Number(nuevoProducto.stock_cedis || 0),
        stock_san_luis_potosi: Number(nuevoProducto.stock_san_luis_potosi || 0),
        cat: nuevoProducto.cat || undefined,
        url_imagen: nuevoProducto.url_imagen || undefined,
        tags: nuevoProducto.tags || undefined,
        seo_description: nuevoProducto.seo_description || undefined,
        edad_recomendada: nuevoProducto.edad_recomendada || undefined,
        genero: nuevoProducto.genero || undefined,
      });
      setMsgProducto(`Producto "${nuevoProducto.name}" creado.`);
      setNuevoProducto(PRODUCTO_VACIO);
    } catch (e) { setMsgProducto(e.message); }
  };

  const crearUsuario = async () => {
    setMsgUsuarios('');
    try {
      await api.post('/api/prime/usuarios', nuevoUsuario);
      setNuevoUsuario({ username: '', password: '', rol: 'admin' });
      cargarUsuarios();
    } catch (e) { setMsgUsuarios(e.message); }
  };

  const cambiarRolUsuario = async (id, rol) => {
    try { await api.put(`/api/prime/usuarios/${id}`, { rol }); cargarUsuarios(); }
    catch (e) { setMsgUsuarios(e.message); }
  };

  const borrarUsuario = async (id) => {
    try { await api.del(`/api/prime/usuarios/${id}`); cargarUsuarios(); }
    catch (e) { setMsgUsuarios(e.message); }
  };

  const agregarPalabra = async () => {
    setMsgFiltro('');
    try {
      await api.post('/api/prime/palabras-filtro', {
        categoria: nuevaCategoria,
        palabra: nuevaPalabra,
        puntos: nuevaCategoria === 'risk' ? Number(nuevosPuntos) : undefined,
      });
      setNuevaPalabra('');
      cargarPalabras();
    } catch (e) { setMsgFiltro(e.message); }
  };

  const togglePalabra = async (id, activo) => {
    try { await api.put(`/api/prime/palabras-filtro/${id}`, { activo }); cargarPalabras(); }
    catch (e) { setMsgFiltro(e.message); }
  };

  const eliminarPalabra = async (id) => {
    try { await api.del(`/api/prime/palabras-filtro/${id}`); cargarPalabras(); }
    catch (e) { setMsgFiltro(e.message); }
  };

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

  const guardarStockMinimo = async (id) => {
    setMsgInventario('');
    const valor = Number(editandoMinimo[id]);
    if (!Number.isFinite(valor) || valor < 0) { setMsgInventario('stock_minimo inválido'); return; }
    try {
      await api.put(`/api/prime/inventarios/${id}`, { stock_minimo: valor });
      setEditandoMinimo(prev => { const next = { ...prev }; delete next[id]; return next; });
      cargarInventarios(buscarInventario);
    } catch (e) { setMsgInventario(e.message); }
  };

  return (
    <div>
      <div className="page-title">Prime</div>
      <div className="page-sub">Configuración avanzada — visible solo para el rol prime</div>
      {msg && <div className="card" style={{ marginBottom: 20 }}>{msg}</div>}

      <div className="card" style={{ marginBottom: 20, maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>Nombre del negocio</h3>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Se muestra en el panel (sidebar). Útil si se revende este sistema a otra juguetería.
        </p>
        <div className="login-field">
          <input type="text" maxLength={80} value={nombreNegocio} onChange={e => setNombreNegocio(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={guardarNegocio}>Guardar</button>
      </div>

      <div className="card" style={{ marginBottom: 20, maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>Costo de envío default</h3>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Se aplica a pedidos nuevos. No requiere un pedido específico.
        </p>
        <div className="login-field">
          <input type="number" min="0" value={costoDefault} onChange={e => setCostoDefault(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={guardarDefault}>Guardar</button>
      </div>

      <div className="card" style={{ marginBottom: 20, maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>Días de entrega Estafeta</h3>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Días hábiles que se suman para estimar la fecha de entrega. Sube este número en
          fechas como navidad si los pedidos se van a retrasar más de lo normal.
        </p>
        <div className="login-field">
          <input type="number" min="1" max="30" value={diasEntrega} onChange={e => setDiasEntrega(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={guardarDiasEntrega}>Guardar</button>
      </div>

      <div className="card" style={{ marginBottom: 20, maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>Reconexión automática de WhatsApp</h3>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Por defecto, si WhatsApp se desconecta el bot se queda detenido hasta que alguien lo
          reinicie manualmente desde el widget de estatus. Activa esto si prefieres que el bot
          intente reconectarse solo (en el mismo proceso) cuando no haya nadie pendiente de él —
          a cambio de un riesgo pequeño de quedar con un Chrome zombie si la desconexión fue por
          un perfil corrupto.
        </p>
        {msgReconexion && <div style={{ marginBottom: 12, color: '#e66' }}>{msgReconexion}</div>}
        <button className="btn" onClick={toggleReconexionAuto}>
          {reconexionAuto ? 'Desactivar reconexión automática' : 'Activar reconexión automática'}
        </button>
        <span className={`badge badge-${reconexionAuto ? 'verde' : 'rojo'}`} style={{ marginLeft: 10 }}>
          {txt(reconexionAuto ? '✅ Activa' : '⛔ Inactiva')}
        </span>
      </div>

      <div className="card" style={{ maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>Corregir un pedido puntual (opcional)</h3>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Solo si Estafeta cotizó distinto a la simulación para un pedido ya creado.
        </p>
        <div className="login-field">
          <label>ID de pedido</label>
          <input type="number" value={idPedido} onChange={e => setIdPedido(e.target.value)} />
        </div>
        <div className="login-field">
          <label>Costo de envío</label>
          <input type="number" min="0" value={costoPedido} onChange={e => setCostoPedido(e.target.value)} />
        </div>
        <button className="btn" disabled={!idPedido} onClick={guardarPedido}>Actualizar pedido</button>
      </div>

      <div className="card" style={{ marginTop: 20, maxWidth: 720 }}>
        <h3 style={{ marginTop: 0 }}>Lista negra y frases de queja</h3>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Las palabras marcadas "código fuente" son fijas y no se pueden borrar ni desactivar —
          ya las aplica el bot siempre. Agrega aquí palabras nuevas para enriquecerlas;
          el bot las toma en cuenta automáticamente (refresco cada 60s).
        </p>
        {msgFiltro && <div style={{ marginBottom: 12, color: '#e66' }}>{msgFiltro}</div>}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <select value={nuevaCategoria} onChange={e => setNuevaCategoria(e.target.value)}>
            {CATEGORIAS_FILTRO.map(c => <option key={c.valor} value={c.valor}>{c.etiqueta}</option>)}
          </select>
          <input
            type="text"
            placeholder="palabra o frase"
            value={nuevaPalabra}
            onChange={e => setNuevaPalabra(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          {nuevaCategoria === 'risk' && (
            <input
              type="number"
              min="1"
              max="10"
              value={nuevosPuntos}
              onChange={e => setNuevosPuntos(e.target.value)}
              style={{ width: 80 }}
              title="Puntos de riesgo"
            />
          )}
          <button className="btn btn-primary" disabled={!nuevaPalabra.trim()} onClick={agregarPalabra}>Agregar</button>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Categoría</th>
              <th>Palabra / frase</th>
              <th>Puntos</th>
              <th>Origen</th>
              <th>Activa</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {palabras.map((p, i) => (
              <tr key={p.id ?? `base-${i}`}>
                <td>{p.categoria}</td>
                <td>{p.palabra}</td>
                <td>{p.puntos ?? ''}</td>
                <td>{p.origen === 'codigo_fuente' ? 'código fuente' : 'agregado'}</td>
                <td>{p.activo ? 'sí' : 'no'}</td>
                <td>
                  {p.origen === 'dashboard' && (
                    <>
                      <button className="btn" onClick={() => togglePalabra(p.id, !p.activo)}>
                        {p.activo ? 'Desactivar' : 'Activar'}
                      </button>{' '}
                      <button className="btn" onClick={() => eliminarPalabra(p.id)}>Borrar</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 20, maxWidth: 720 }}>
        <h3 style={{ marginTop: 0 }}>Sucursales</h3>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Registro de tiendas/bodegas. Desactiva en vez de borrar si ya tiene movimientos de inventario.
        </p>
        {msgSucursales && <div style={{ marginBottom: 12, color: '#e66' }}>{msgSucursales}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <input type="text" placeholder="Nombre" value={nuevaSucursal.nombre}
            onChange={e => setNuevaSucursal({ ...nuevaSucursal, nombre: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
          <input type="text" placeholder="Código (opcional)" value={nuevaSucursal.codigo}
            onChange={e => setNuevaSucursal({ ...nuevaSucursal, codigo: e.target.value })} style={{ width: 140 }} />
          <input type="text" placeholder="Dirección (opcional)" value={nuevaSucursal.direccion}
            onChange={e => setNuevaSucursal({ ...nuevaSucursal, direccion: e.target.value })} style={{ flex: 1, minWidth: 200 }} />
          <button className="btn btn-primary" disabled={!nuevaSucursal.nombre.trim()} onClick={crearSucursal}>Agregar</button>
        </div>
        <table className="table">
          <thead><tr><th>Nombre</th><th>Código</th><th>Dirección</th><th>Activa</th><th></th></tr></thead>
          <tbody>
            {sucursales.map(s => (
              <tr key={s.id}>
                <td>{s.nombre}</td>
                <td>{s.codigo || ''}</td>
                <td>{s.direccion || ''}</td>
                <td>{s.activa ? 'sí' : 'no'}</td>
                <td>
                  <button className="btn" onClick={() => toggleSucursal(s.id, !s.activa)}>
                    {s.activa ? 'Desactivar' : 'Activar'}
                  </button>{' '}
                  <button className="btn" onClick={() => borrarSucursal(s.id)}>Borrar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 20, maxWidth: 720 }}>
        <h3 style={{ marginTop: 0 }}>Stock mínimo por sucursal</h3>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Umbral que dispara la alerta automática al asesor cuando el stock de un producto
          en una sucursal cae a este nivel o menos. En 0, la alerta queda desactivada para esa fila.
        </p>
        {msgInventario && <div style={{ marginBottom: 12, color: '#e66' }}>{msgInventario}</div>}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Buscar producto..."
            value={buscarInventario}
            onChange={e => setBuscarInventario(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') cargarInventarios(buscarInventario); }}
            style={{ flex: 1, minWidth: 200 }}
          />
          <button className="btn" onClick={() => cargarInventarios(buscarInventario)}>Buscar</button>
        </div>
        <table className="table">
          <thead><tr><th>Producto</th><th>Sucursal</th><th>Stock</th><th>Stock mínimo</th><th></th></tr></thead>
          <tbody>
            {inventarios.map(i => (
              <tr key={i.id}>
                <td>{i.producto}</td>
                <td>{i.sucursal}</td>
                <td>{i.stock}</td>
                <td>
                  <input
                    type="number"
                    min="0"
                    style={{ width: 80 }}
                    value={editandoMinimo[i.id] ?? i.stock_minimo}
                    onChange={e => setEditandoMinimo(prev => ({ ...prev, [i.id]: e.target.value }))}
                  />
                </td>
                <td><button className="btn" onClick={() => guardarStockMinimo(i.id)}>Guardar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 20, maxWidth: 720 }}>
        <h3 style={{ marginTop: 0 }}>Alta de producto</h3>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Agrega un producto puntual al catálogo (la carga masiva sigue siendo aparte).
        </p>
        {msgProducto && <div style={{ marginBottom: 12 }}>{msgProducto}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <input type="text" placeholder="Nombre *" value={nuevoProducto.name}
            onChange={e => setNuevoProducto({ ...nuevoProducto, name: e.target.value })} />
          <input type="number" min="0" step="0.01" placeholder="Precio *" value={nuevoProducto.price}
            onChange={e => setNuevoProducto({ ...nuevoProducto, price: e.target.value })} />
          <input type="text" placeholder="Categoría" value={nuevoProducto.cat}
            onChange={e => setNuevoProducto({ ...nuevoProducto, cat: e.target.value })} />
          <input type="text" placeholder="Género" value={nuevoProducto.genero}
            onChange={e => setNuevoProducto({ ...nuevoProducto, genero: e.target.value })} />
          <input type="text" placeholder="Edad recomendada" value={nuevoProducto.edad_recomendada}
            onChange={e => setNuevoProducto({ ...nuevoProducto, edad_recomendada: e.target.value })} />
          <input type="number" min="0" placeholder="Edad mínima" value={nuevoProducto.edad_min}
            onChange={e => setNuevoProducto({ ...nuevoProducto, edad_min: e.target.value })} />
          <input type="text" placeholder="Tags (separados por coma)" value={nuevoProducto.tags}
            onChange={e => setNuevoProducto({ ...nuevoProducto, tags: e.target.value })} style={{ gridColumn: '1 / -1' }} />
          <input type="text" placeholder="URL de imagen" value={nuevoProducto.url_imagen}
            onChange={e => setNuevoProducto({ ...nuevoProducto, url_imagen: e.target.value })} style={{ gridColumn: '1 / -1' }} />
          <textarea placeholder="Descripción SEO" value={nuevoProducto.seo_description}
            onChange={e => setNuevoProducto({ ...nuevoProducto, seo_description: e.target.value })} style={{ gridColumn: '1 / -1' }} />
          <input type="number" min="0" placeholder="Stock tienda" value={nuevoProducto.stock_tienda}
            onChange={e => setNuevoProducto({ ...nuevoProducto, stock_tienda: e.target.value })} />
          <input type="number" min="0" placeholder="Stock CEDIS" value={nuevoProducto.stock_cedis}
            onChange={e => setNuevoProducto({ ...nuevoProducto, stock_cedis: e.target.value })} />
          <input type="number" min="0" placeholder="Stock San Luis Potosí" value={nuevoProducto.stock_san_luis_potosi}
            onChange={e => setNuevoProducto({ ...nuevoProducto, stock_san_luis_potosi: e.target.value })} />
        </div>
        <button className="btn btn-primary" onClick={crearProducto}>Crear producto</button>
      </div>

      <div className="card" style={{ marginTop: 20, maxWidth: 720 }}>
        <h3 style={{ marginTop: 0 }}>Usuarios del dashboard</h3>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Crea cuentas con rol admin (operación) o prime (acceso total). No puedes borrar tu propia
          cuenta ni dejar el sistema sin ningún usuario prime.
        </p>
        {msgUsuarios && <div style={{ marginBottom: 12, color: '#e66' }}>{msgUsuarios}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <input type="text" placeholder="Usuario" value={nuevoUsuario.username}
            onChange={e => setNuevoUsuario({ ...nuevoUsuario, username: e.target.value })} style={{ minWidth: 160 }} />
          <input type="password" placeholder="Password (mín. 8)" value={nuevoUsuario.password}
            onChange={e => setNuevoUsuario({ ...nuevoUsuario, password: e.target.value })} style={{ minWidth: 160 }} />
          <select value={nuevoUsuario.rol} onChange={e => setNuevoUsuario({ ...nuevoUsuario, rol: e.target.value })}>
            <option value="admin">admin</option>
            <option value="prime">prime</option>
          </select>
          <button className="btn btn-primary" disabled={!nuevoUsuario.username.trim() || !nuevoUsuario.password} onClick={crearUsuario}>
            Crear usuario
          </button>
        </div>
        <table className="table">
          <thead><tr><th>Usuario</th><th>Rol</th><th>Creado</th><th></th></tr></thead>
          <tbody>
            {usuarios.map(u => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>
                  <select value={u.rol} onChange={e => cambiarRolUsuario(u.id, e.target.value)}>
                    <option value="admin">admin</option>
                    <option value="prime">prime</option>
                  </select>
                </td>
                <td>{u.creado_en}</td>
                <td><button className="btn" onClick={() => borrarUsuario(u.id)}>Borrar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
