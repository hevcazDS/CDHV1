import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@mantine/form';
import {
  Card, Title, Group, ActionIcon, Table, Badge, Switch, Tabs, SimpleGrid,
  TextInput, NumberInput, PasswordInput, Select, Textarea, Button,
  Fieldset, Pagination, SegmentedControl,
} from '@mantine/core';
import { api } from '../api';
import Modal from '../components/Modal';
import { useTextoEmoji } from '../context/EmojiContext';
import { guardarPreferenciasFuente } from '../lib/fontPrefs';

const CATEGORIAS_FILTRO = [
  { valor: 'bw_word',   etiqueta: 'Lista negra — palabra corta (match exacto)' },
  { valor: 'bw_long',   etiqueta: 'Lista negra — frase larga (substring)' },
  { valor: 'risk',      etiqueta: 'Riesgo (puntos acumulables)' },
  { valor: 'queja_l1',  etiqueta: 'Queja — nivel 1' },
  { valor: 'queja_l2',  etiqueta: 'Queja — nivel 2 (pedir humano)' },
];

// Valores reales que entiende el wizard de recomendación (bot/flows/_shared.js
// generoMap/tipoMap + bot/flows/menuFlow.js) — un valor fuera de esta lista
// simplemente nunca hace match en el wizard, por eso son Select de opción fija
// y no texto libre como `tags`.
const GENERO_OPTIONS = [
  { value: 'nino', label: 'Niño' },
  { value: 'nina', label: 'Niña' },
  { value: 'unisex', label: 'Unisex' },
];
const TIPO_JUGUETE_OPTIONS = [
  { value: 'diversion', label: 'Diversión' },
  { value: 'educativo', label: 'Educativo' },
  { value: 'creativo', label: 'Creativo' },
  { value: 'coleccionable', label: 'Coleccionable' },
  { value: 'peluche', label: 'Peluche' },
];
const CATEGORIA_NUEVA = '__nueva__';

const TABS = [
  { key: 'general', label: '⚙️ General' },
  { key: 'sucursales', label: '🏬 Sucursales' },
  { key: 'inventario', label: '📊 Inventario' },
  { key: 'catalogo', label: '🧸 Catálogo' },
  { key: 'usuarios', label: '👤 Usuarios' },
  { key: 'filtros', label: '🚫 Filtros' },
];

export default function Prime() {
  const txt = useTextoEmoji();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('general');
  const [costoDefault, setCostoDefault] = useState('');
  const [idPedido, setIdPedido] = useState('');
  const [costoPedido, setCostoPedido] = useState('');
  const [nombreNegocio, setNombreNegocio] = useState('');
  const [diasEntrega, setDiasEntrega] = useState('');
  const [msg, setMsg] = useState('');

  // ── Reconexión automática de WhatsApp ────────────────────────────────────
  const [reconexionAuto, setReconexionAuto] = useState(false);
  const [msgReconexion, setMsgReconexion] = useState('');

  // ── Contacto: teléfono del operador, soporte, destino de backups ────────
  const contactoForm = useForm({ initialValues: {
    operador_telefono: '', soporte_url: '', soporte_telefono: '', soporte_correo: '', email_backup_destino: '',
  } });
  const [msgContacto, setMsgContacto] = useState('');

  // ── Correo + contraseña de aplicación del propio bot ────────────────────
  const [botEmailUsuario, setBotEmailUsuario] = useState('');
  const [botEmailPassword, setBotEmailPassword] = useState('');
  const [botEmailPassConfigurada, setBotEmailPassConfigurada] = useState(false);
  const [msgEmailBot, setMsgEmailBot] = useState('');

  // ── Tope de descuento para usuarios admin en Ofertas/Cupones ────────────
  const [topeDescuento, setTopeDescuento] = useState('');
  const [msgTope, setMsgTope] = useState('');

  // ── Sucursal de facturación default (Fase 3: tickets + alta simplificada) ─
  const [sucursalFacturacion, setSucursalFacturacion] = useState('');
  const [msgSucursalFacturacion, setMsgSucursalFacturacion] = useState('');

  // ── Fuente y tamaño (preferencia de navegador, ver lib/fontPrefs.js) ─────
  const [fuentePrefs, setFuentePrefs] = useState(() => {
    const familia = localStorage.getItem('jc-fuente-familia') || 'inter';
    const tamano = localStorage.getItem('jc-fuente-tamano') || 'normal';
    return { familia, tamano };
  });
  const guardarFuente = () => {
    guardarPreferenciasFuente(fuentePrefs.familia, fuentePrefs.tamano);
  };

  const [nuevaCategoria, setNuevaCategoria] = useState('bw_word');
  const [nuevaPalabra, setNuevaPalabra] = useState('');
  const [nuevosPuntos, setNuevosPuntos] = useState('1');
  const [msgFiltro, setMsgFiltro] = useState('');

  // ── Sucursales ──────────────────────────────────────────────────────────
  const sucursalForm = useForm({ initialValues: { nombre: '', codigo: '', direccion: '', codigo_postal: '' } });
  const [msgSucursales, setMsgSucursales] = useState('');
  const [sucursalEditando, setSucursalEditando] = useState(null);
  const editarSucursalForm = useForm({ initialValues: { nombre: '', codigo: '', direccion: '', codigo_postal: '' } });
  const [msgEditarSucursal, setMsgEditarSucursal] = useState('');

  // ── Alta de productos — todas las columnas reales de `productos` (ver
  // db/schema.sql) expuestas de una vez, no por etapas. ──────────────────
  const PRODUCTO_VACIO = {
    name: '', price: '', sku: '', upc: '', brand: '', handle: '',
    cat: '', id_categoria: null,
    genero: '', tipo_juguete: '', edad_min: 0, edad_max: 99,
    peso_kg: '', alto_cm: '', ancho_cm: '', largo_cm: '',
    url_imagen: '', description: '', seo_description: '', tags: '', material: '', color: '', target_audience: '',
    stock_tienda: '0', stock_cedis: '0', stock_san_luis_potosi: '0',
    stock_exhibicion: '0', stock_queretaro: '0', stock_monterrey: '0', stock_cdmx_centro: '0', stock_base: '0',
  };
  const productoForm = useForm({ initialValues: PRODUCTO_VACIO });
  const [msgProducto, setMsgProducto] = useState('');
  const [mostrarNuevaCategoria, setMostrarNuevaCategoria] = useState(false);
  const [categoriaNuevaNombre, setCategoriaNuevaNombre] = useState('');
  // Stock inicial -- antes se sembraba en TODAS las sucursales activas (red
  // de 11, ver migrations/0005); el operador pidió simplificarlo a un solo
  // número, sembrado solo en la sucursal de facturación default (ver
  // sucursalFacturacion más abajo y /api/prime/sucursal-facturacion-default)
  // ya que la deducción real de stock en una venta multi-sucursal ya
  // funciona sola vía pedido_detalle.sucursal_origen -- no depende de que
  // todas las sucursales tengan una fila desde el alta.
  const [stockInicial, setStockInicial] = useState('0');

  // ── Catálogo: ver/buscar/editar productos existentes (antes solo había
  // alta, sin forma de revisar los 600 que ya existen) ─────────────────────
  const [buscarCatalogo, setBuscarCatalogo] = useState('');
  const [paginaCatalogo, setPaginaCatalogo] = useState(1);
  const [productoEditando, setProductoEditando] = useState(null);
  const [mostrarNuevaCategoriaEditar, setMostrarNuevaCategoriaEditar] = useState(false);
  const [categoriaNuevaNombreEditar, setCategoriaNuevaNombreEditar] = useState('');
  const editarForm = useForm({ initialValues: PRODUCTO_VACIO });
  const [msgEditarProducto, setMsgEditarProducto] = useState('');

  // ── Usuarios del dashboard ──────────────────────────────────────────────
  const usuarioForm = useForm({ initialValues: { username: '', password: '', rol: 'admin' } });
  const [msgUsuarios, setMsgUsuarios] = useState('');
  const [usuarioEditando, setUsuarioEditando] = useState(null);
  const editarUsuarioForm = useForm({ initialValues: { nombre: '', password: '' } });
  const [msgEditarUsuario, setMsgEditarUsuario] = useState('');

  // ── Stock por producto+sucursal (tabla `inventarios`, ahora con filtro
  // por sucursal real y paginación -- antes mostraba hasta 300 filas de
  // golpe sin forma de llegar a las demás) ──────────────────────────────────
  const [vistaInventario, setVistaInventario] = useState('stock');
  const [buscarInventario, setBuscarInventario] = useState('');
  const [sucursalInventario, setSucursalInventario] = useState('');
  const [paginaInventario, setPaginaInventario] = useState(1);
  const [editandoMinimo, setEditandoMinimo] = useState({});
  const [msgInventario, setMsgInventario] = useState('');
  const [paginaMovimientos, setPaginaMovimientos] = useState(1);

  // ── Filtros: por default solo se ve lo que el dashboard administra -- las
  // 117 palabras de código fuente (fijas, nunca se editan) quedan ocultas
  // salvo que se pidan explícitamente, y se puede acotar por categoría ────
  const [categoriaVistaFiltros, setCategoriaVistaFiltros] = useState('todas');
  const [mostrarCodigoFuente, setMostrarCodigoFuente] = useState(false);

  const { data: palabras = [] } = useQuery({
    queryKey: ['prime-palabras-filtro'],
    queryFn: () => api.get('/api/prime/palabras-filtro').then(d => d.items || []),
  });
  const { data: sucursales = [] } = useQuery({
    queryKey: ['prime-sucursales'],
    queryFn: () => api.get('/api/prime/sucursales'),
  });
  const { data: categorias = [] } = useQuery({
    queryKey: ['prime-categorias'],
    queryFn: () => api.get('/api/prime/categorias'),
  });
  const { data: usuarios = [] } = useQuery({
    queryKey: ['prime-usuarios'],
    queryFn: () => api.get('/api/prime/usuarios'),
  });
  const { data: inventariosResp } = useQuery({
    queryKey: ['prime-inventarios', buscarInventario, sucursalInventario, paginaInventario],
    queryFn: () => {
      const params = new URLSearchParams();
      if (buscarInventario) params.set('q', buscarInventario);
      if (sucursalInventario) params.set('sucursal', sucursalInventario);
      params.set('pagina', String(paginaInventario));
      return api.get(`/api/prime/inventarios?${params.toString()}`);
    },
  });
  const inventarios = inventariosResp?.items || [];
  const totalPaginasInventario = Math.max(1, Math.ceil((inventariosResp?.total || 0) / (inventariosResp?.porPagina || 30)));

  const { data: movimientosResp } = useQuery({
    queryKey: ['prime-inventario-movimientos', sucursalInventario, paginaMovimientos],
    queryFn: () => {
      const params = new URLSearchParams();
      if (sucursalInventario) params.set('sucursal', sucursalInventario);
      params.set('pagina', String(paginaMovimientos));
      return api.get(`/api/prime/inventario-movimientos?${params.toString()}`);
    },
    enabled: vistaInventario === 'historial',
  });
  const movimientos = movimientosResp?.items || [];
  const totalPaginasMovimientos = Math.max(1, Math.ceil((movimientosResp?.total || 0) / (movimientosResp?.porPagina || 30)));

  const { data: productosResp } = useQuery({
    queryKey: ['prime-productos-lista', buscarCatalogo, paginaCatalogo],
    queryFn: () => {
      const params = new URLSearchParams();
      if (buscarCatalogo) params.set('q', buscarCatalogo);
      params.set('pagina', String(paginaCatalogo));
      return api.get(`/api/prime/productos?${params.toString()}`);
    },
  });
  const productosLista = productosResp?.items || [];
  const totalPaginasCatalogo = Math.max(1, Math.ceil((productosResp?.total || 0) / (productosResp?.porPagina || 20)));

  const palabrasFiltradas = palabras.filter(p => {
    if (!mostrarCodigoFuente && p.origen === 'codigo_fuente') return false;
    if (categoriaVistaFiltros !== 'todas' && p.categoria !== categoriaVistaFiltros) return false;
    return true;
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
      const d = await api.put('/api/prime/config-email-bot', datos);
      setBotEmailPassword('');
      if (datos.bot_email_password) setBotEmailPassConfigurada(true);
      setMsgEmailBot('Guardado.');
    } catch (e) { setMsgEmailBot(e.message); }
  };

  const toggleReconexionAuto = async () => {
    setMsgReconexion('');
    const activo = !reconexionAuto;
    try {
      await api.post('/api/prime/config', { clave: 'reconexion_auto_activo', activo });
      setReconexionAuto(activo);
    } catch (e) { setMsgReconexion(e.message); }
  };

  const crearSucursalMutation = useMutation({
    mutationFn: (values) => api.post('/api/prime/sucursales', {
      nombre: values.nombre,
      codigo: values.codigo || undefined,
      direccion: values.direccion || undefined,
      codigo_postal: values.codigo_postal || undefined,
    }),
    onSuccess: () => {
      sucursalForm.reset();
      queryClient.invalidateQueries({ queryKey: ['prime-sucursales'] });
    },
    onError: (e) => setMsgSucursales(e.message),
  });
  const crearSucursal = () => { setMsgSucursales(''); crearSucursalMutation.mutate(sucursalForm.values); };

  const toggleSucursalMutation = useMutation({
    mutationFn: ({ id, activa }) => api.put(`/api/prime/sucursales/${id}`, { activa }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prime-sucursales'] }),
    onError: (e) => setMsgSucursales(e.message),
  });
  const toggleSucursal = (id, activa) => toggleSucursalMutation.mutate({ id, activa });

  const editarSucursalMutation = useMutation({
    mutationFn: ({ id, datos }) => api.put(`/api/prime/sucursales/${id}`, datos),
    onSuccess: () => {
      setSucursalEditando(null);
      queryClient.invalidateQueries({ queryKey: ['prime-sucursales'] });
    },
    onError: (e) => setMsgEditarSucursal(e.message),
  });
  const abrirEdicionSucursal = (s) => {
    setMsgEditarSucursal('');
    editarSucursalForm.setValues({
      nombre: s.nombre || '', codigo: s.codigo || '', direccion: s.direccion || '', codigo_postal: s.codigo_postal || '',
    });
    setSucursalEditando(s);
  };
  const guardarEdicionSucursal = () => {
    setMsgEditarSucursal('');
    const v = editarSucursalForm.values;
    if (!v.nombre.trim()) { setMsgEditarSucursal('El nombre es obligatorio.'); return; }
    editarSucursalMutation.mutate({
      id: sucursalEditando.id,
      datos: {
        nombre: v.nombre, codigo: v.codigo || undefined, direccion: v.direccion || undefined,
        codigo_postal: v.codigo_postal || undefined,
      },
    });
  };

  const borrarSucursalMutation = useMutation({
    mutationFn: (id) => api.del(`/api/prime/sucursales/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prime-sucursales'] }),
    onError: (e) => setMsgSucursales(e.message),
  });
  const borrarSucursal = (id) => borrarSucursalMutation.mutate(id);

  // Mapeo único de los valores de form (alta y edición comparten exactamente
  // las mismas columnas reales de `productos`) al payload que espera la API.
  // edad_recomendada NO se manda: el servidor la calcula desde edad_min/max.
  const armarDatosProducto = (v) => ({
    name: v.name,
    price: Number(v.price),
    sku: v.sku || undefined,
    upc: v.upc || undefined,
    brand: v.brand || undefined,
    handle: v.handle || undefined,
    cat: v.cat || undefined,
    id_categoria: v.id_categoria ? Number(v.id_categoria) : undefined,
    genero: v.genero || undefined,
    tipo_juguete: v.tipo_juguete || undefined,
    edad_min: v.edad_min === '' || v.edad_min == null ? undefined : Number(v.edad_min),
    edad_max: v.edad_max === '' || v.edad_max == null ? undefined : Number(v.edad_max),
    peso_kg: v.peso_kg === '' || v.peso_kg == null ? undefined : Number(v.peso_kg),
    alto_cm: v.alto_cm === '' || v.alto_cm == null ? undefined : Number(v.alto_cm),
    ancho_cm: v.ancho_cm === '' || v.ancho_cm == null ? undefined : Number(v.ancho_cm),
    largo_cm: v.largo_cm === '' || v.largo_cm == null ? undefined : Number(v.largo_cm),
    url_imagen: v.url_imagen || undefined,
    description: v.description || undefined,
    seo_description: v.seo_description || undefined,
    tags: v.tags || undefined,
    material: v.material || undefined,
    color: v.color || undefined,
    target_audience: v.target_audience || undefined,
    stock_tienda: Number(v.stock_tienda || 0),
    stock_cedis: Number(v.stock_cedis || 0),
    stock_san_luis_potosi: Number(v.stock_san_luis_potosi || 0),
    stock_exhibicion: Number(v.stock_exhibicion || 0),
    stock_queretaro: Number(v.stock_queretaro || 0),
    stock_monterrey: Number(v.stock_monterrey || 0),
    stock_cdmx_centro: Number(v.stock_cdmx_centro || 0),
    stock_base: v.stock_base === '' || v.stock_base == null ? undefined : Number(v.stock_base),
  });

  // Categoría "crear nueva" — el Select de categoría usa el sentinel
  // CATEGORIA_NUEVA para abrir un TextInput inline en vez de navegar a otra
  // pantalla; al crear, se fija id_categoria Y cat (texto legacy que de
  // verdad usa bot/flows/_shared.js para buscar) al mismo valor para que no
  // queden desincronizados.
  const crearCategoriaMutation = useMutation({
    mutationFn: (nombre) => api.post('/api/prime/categorias', { nombre }),
  });
  const crearCategoriaYAsignar = (nombre, form, setNombre, setMostrar) => {
    if (!nombre.trim()) return;
    crearCategoriaMutation.mutate(nombre.trim(), {
      onSuccess: (r) => {
        queryClient.invalidateQueries({ queryKey: ['prime-categorias'] });
        form.setValues(v => ({ ...v, id_categoria: r.id, cat: r.nombre }));
        setNombre('');
        setMostrar(false);
      },
    });
  };

  // Select de categoría reutilizado en alta y edición — mismo componente,
  // distinto form/estado de creación según cuál se esté usando.
  const renderSelectCategoria = (form, mostrarNueva, setMostrarNueva, nombreNuevo, setNombreNuevo) => (
    <div>
      <Select
        label="Categoría"
        placeholder="Selecciona o crea una categoría"
        searchable
        clearable
        data={[
          ...categorias.map(c => ({ value: String(c.id), label: c.nombre })),
          { value: CATEGORIA_NUEVA, label: '+ Crear categoría nueva...' },
        ]}
        value={form.values.id_categoria ? String(form.values.id_categoria) : null}
        onChange={(value) => {
          if (value === CATEGORIA_NUEVA) { setMostrarNueva(true); return; }
          const c = categorias.find(c => String(c.id) === value);
          form.setValues(v => ({ ...v, id_categoria: c ? c.id : null, cat: c ? c.nombre : v.cat }));
        }}
      />
      {mostrarNueva && (
        <Group gap="xs" mt={6}>
          <TextInput
            placeholder="Nombre de la nueva categoría"
            value={nombreNuevo}
            onChange={e => setNombreNuevo(e.target.value)}
            style={{ flex: 1 }}
          />
          <Button size="xs" onClick={() => crearCategoriaYAsignar(nombreNuevo, form, setNombreNuevo, setMostrarNueva)}>Crear</Button>
          <Button size="xs" variant="default" onClick={() => { setMostrarNueva(false); setNombreNuevo(''); }}>Cancelar</Button>
        </Group>
      )}
    </div>
  );

  // Bloque de Fieldsets compartido entre Alta y Edición de producto — ambos
  // tocan exactamente las mismas columnas reales de `productos` (decisión
  // explícita: exponer todas de una vez, no por etapas). Lo único que NO
  // comparten es la siembra inicial de `inventarios` por sucursal (solo
  // tiene sentido en el alta) y el botón de acción final.
  const renderCamposProducto = (form, mostrarNuevaCat, setMostrarNuevaCat, nombreNuevaCat, setNombreNuevaCat) => (
    <>
      <Fieldset legend="Identificación" mb="md">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
          <TextInput label="SKU" {...form.getInputProps('sku')} />
          <TextInput label="UPC / código de barras" {...form.getInputProps('upc')} />
          <TextInput label="Marca" {...form.getInputProps('brand')} />
          <TextInput label="Handle (slug)" {...form.getInputProps('handle')} />
        </div>
      </Fieldset>

      <Fieldset legend="Datos básicos" mb="md">
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: 8 }}>
          <TextInput label="Nombre" placeholder="Nombre *" {...form.getInputProps('name')} />
          <TextInput label="Precio" type="number" min={0} step="0.01" placeholder="Precio *" {...form.getInputProps('price')} />
          {renderSelectCategoria(form, mostrarNuevaCat, setMostrarNuevaCat, nombreNuevaCat, setNombreNuevaCat)}
        </div>
      </Fieldset>

      <Fieldset legend="Clasificación" mb="md">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
          <Select label="Género" placeholder="Género" data={GENERO_OPTIONS} clearable {...form.getInputProps('genero')} />
          <Select label="Tipo de juguete" placeholder="Tipo" data={TIPO_JUGUETE_OPTIONS} clearable {...form.getInputProps('tipo_juguete')} />
          <NumberInput label="Edad mínima" min={0} max={99} clampBehavior="strict" allowDecimal={false} {...form.getInputProps('edad_min')} />
          <NumberInput label="Edad máxima" min={0} max={99} clampBehavior="strict" allowDecimal={false} {...form.getInputProps('edad_max')} />
        </div>
        <TextInput label="Tags (separados por coma)" {...form.getInputProps('tags')} />
      </Fieldset>

      <Fieldset legend="Dimensiones y peso" mb="md">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
          <NumberInput label="Peso (kg)" min={0} step={0.01} {...form.getInputProps('peso_kg')} />
          <NumberInput label="Alto (cm)" min={0} step={0.1} {...form.getInputProps('alto_cm')} />
          <NumberInput label="Ancho (cm)" min={0} step={0.1} {...form.getInputProps('ancho_cm')} />
          <NumberInput label="Largo (cm)" min={0} step={0.1} {...form.getInputProps('largo_cm')} />
        </div>
      </Fieldset>

      <Fieldset legend="Imagen y contenido" mb="md">
        <TextInput label="URL de imagen" {...form.getInputProps('url_imagen')} mb="sm" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
          <TextInput label="Material" {...form.getInputProps('material')} />
          <TextInput label="Color" {...form.getInputProps('color')} />
          <TextInput label="Público objetivo" {...form.getInputProps('target_audience')} />
        </div>
        <Textarea label="Descripción" mb="sm" {...form.getInputProps('description')} />
        <Textarea label="Descripción SEO" {...form.getInputProps('seo_description')} />
      </Fieldset>

      <Fieldset legend="Stock fijo (columnas en productos)" mb="md">
        <p className="page-sub" style={{ margin: '0 0 12px' }}>
          Las primeras 3 alimentan directamente la búsqueda del bot. Las demás existen en la base
          real pero ningún código las lee todavía — se exponen para no perder el dato si se llega a
          conectar algo a ellas.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 8 }}>
          <NumberInput label="Tienda" min={0} {...form.getInputProps('stock_tienda')} />
          <NumberInput label="CEDIS" min={0} {...form.getInputProps('stock_cedis')} />
          <NumberInput label="San Luis Potosí" min={0} {...form.getInputProps('stock_san_luis_potosi')} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          <NumberInput label="Exhibición" min={0} {...form.getInputProps('stock_exhibicion')} />
          <NumberInput label="Querétaro" min={0} {...form.getInputProps('stock_queretaro')} />
          <NumberInput label="Monterrey" min={0} {...form.getInputProps('stock_monterrey')} />
          <NumberInput label="CDMX Centro" min={0} {...form.getInputProps('stock_cdmx_centro')} />
          <NumberInput label="Stock base" min={0} {...form.getInputProps('stock_base')} />
        </div>
      </Fieldset>
    </>
  );

  const crearProductoMutation = useMutation({
    mutationFn: (v) => api.post('/api/prime/productos', {
      ...armarDatosProducto(v),
      stock_inicial: Number(stockInicial) || 0,
    }),
    onSuccess: (_, v) => {
      setMsgProducto(`Producto "${v.name}" creado.`);
      productoForm.reset();
      setStockInicial('0');
      queryClient.invalidateQueries({ queryKey: ['prime-productos-lista'] });
      queryClient.invalidateQueries({ queryKey: ['prime-inventarios'] });
      queryClient.invalidateQueries({ queryKey: ['prime-inventario-movimientos'] });
    },
    onError: (e) => setMsgProducto(e.message),
  });
  const crearProducto = () => {
    setMsgProducto('');
    const v = productoForm.values;
    if (!v.name.trim() || !v.price) {
      setMsgProducto('Nombre y precio son obligatorios.');
      return;
    }
    crearProductoMutation.mutate(v);
  };

  const editarProductoMutation = useMutation({
    mutationFn: ({ id, datos }) => api.put(`/api/prime/productos/${id}`, datos),
    onSuccess: () => {
      setProductoEditando(null);
      queryClient.invalidateQueries({ queryKey: ['prime-productos-lista'] });
      queryClient.invalidateQueries({ queryKey: ['prime-inventarios'] });
    },
    onError: (e) => setMsgEditarProducto(e.message),
  });
  const abrirEdicionProducto = (p) => {
    setMsgEditarProducto('');
    setCategoriaNuevaNombreEditar('');
    editarForm.setValues({
      name: p.name || '', price: String(p.price ?? 0),
      sku: p.sku || '', upc: p.upc || '', brand: p.brand || '', handle: p.handle || '',
      cat: p.cat || '', id_categoria: p.id_categoria ?? null,
      genero: p.genero || '', tipo_juguete: p.tipo_juguete || '',
      edad_min: p.edad_min ?? 0, edad_max: p.edad_max ?? 99,
      peso_kg: p.peso_kg ?? '', alto_cm: p.alto_cm ?? '', ancho_cm: p.ancho_cm ?? '', largo_cm: p.largo_cm ?? '',
      url_imagen: p.url_imagen || '', description: p.description || '', seo_description: p.seo_description || '',
      tags: p.tags || '', material: p.material || '', color: p.color || '', target_audience: p.target_audience || '',
      stock_tienda: String(p.stock_tienda ?? 0), stock_cedis: String(p.stock_cedis ?? 0),
      stock_san_luis_potosi: String(p.stock_san_luis_potosi ?? 0),
      stock_exhibicion: String(p.stock_exhibicion ?? 0), stock_queretaro: String(p.stock_queretaro ?? 0),
      stock_monterrey: String(p.stock_monterrey ?? 0), stock_cdmx_centro: String(p.stock_cdmx_centro ?? 0),
      stock_base: p.stock_base ?? '',
    });
    setProductoEditando(p);
  };
  const guardarEdicionProducto = () => {
    setMsgEditarProducto('');
    const v = editarForm.values;
    if (!v.name.trim() || !v.price) { setMsgEditarProducto('Nombre y precio son obligatorios.'); return; }
    editarProductoMutation.mutate({ id: productoEditando.id, datos: armarDatosProducto(v) });
  };

  const crearUsuarioMutation = useMutation({
    mutationFn: (values) => api.post('/api/prime/usuarios', values),
    onSuccess: () => {
      usuarioForm.reset();
      queryClient.invalidateQueries({ queryKey: ['prime-usuarios'] });
    },
    onError: (e) => setMsgUsuarios(e.message),
  });
  const crearUsuario = () => { setMsgUsuarios(''); crearUsuarioMutation.mutate(usuarioForm.values); };

  const cambiarRolUsuarioMutation = useMutation({
    mutationFn: ({ id, rol }) => api.put(`/api/prime/usuarios/${id}`, { rol }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prime-usuarios'] }),
    onError: (e) => setMsgUsuarios(e.message),
  });
  const cambiarRolUsuario = (id, rol) => cambiarRolUsuarioMutation.mutate({ id, rol });

  const borrarUsuarioMutation = useMutation({
    mutationFn: (id) => api.del(`/api/prime/usuarios/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prime-usuarios'] }),
    onError: (e) => setMsgUsuarios(e.message),
  });
  const borrarUsuario = (id) => borrarUsuarioMutation.mutate(id);

  const editarUsuarioMutation = useMutation({
    mutationFn: ({ id, datos }) => api.put(`/api/prime/usuarios/${id}`, datos),
    onSuccess: () => {
      setUsuarioEditando(null);
      queryClient.invalidateQueries({ queryKey: ['prime-usuarios'] });
    },
    onError: (e) => setMsgEditarUsuario(e.message),
  });
  const abrirEdicionUsuario = (u) => {
    setMsgEditarUsuario('');
    editarUsuarioForm.setValues({ nombre: u.nombre || '', password: '' });
    setUsuarioEditando(u);
  };
  const guardarEdicionUsuario = () => {
    setMsgEditarUsuario('');
    const v = editarUsuarioForm.values;
    const datos = {};
    if (v.nombre.trim()) datos.nombre = v.nombre.trim();
    if (v.password) {
      if (v.password.length < 8) { setMsgEditarUsuario('La nueva contraseña debe tener al menos 8 caracteres.'); return; }
      datos.password = v.password;
    }
    if (!Object.keys(datos).length) { setMsgEditarUsuario('Nada que actualizar.'); return; }
    editarUsuarioMutation.mutate({ id: usuarioEditando.id, datos });
  };

  const agregarPalabraMutation = useMutation({
    mutationFn: () => api.post('/api/prime/palabras-filtro', {
      categoria: nuevaCategoria,
      palabra: nuevaPalabra,
      puntos: nuevaCategoria === 'risk' ? Number(nuevosPuntos) : undefined,
    }),
    onSuccess: () => {
      setNuevaPalabra('');
      queryClient.invalidateQueries({ queryKey: ['prime-palabras-filtro'] });
    },
    onError: (e) => setMsgFiltro(e.message),
  });
  const agregarPalabra = () => { setMsgFiltro(''); agregarPalabraMutation.mutate(); };

  const togglePalabraMutation = useMutation({
    mutationFn: ({ id, activo }) => api.put(`/api/prime/palabras-filtro/${id}`, { activo }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prime-palabras-filtro'] }),
    onError: (e) => setMsgFiltro(e.message),
  });
  const togglePalabra = (id, activo) => togglePalabraMutation.mutate({ id, activo });

  const eliminarPalabraMutation = useMutation({
    mutationFn: (id) => api.del(`/api/prime/palabras-filtro/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prime-palabras-filtro'] }),
    onError: (e) => setMsgFiltro(e.message),
  });
  const eliminarPalabra = (id) => eliminarPalabraMutation.mutate(id);

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

  const guardarStockMinimoMutation = useMutation({
    mutationFn: ({ id, valor }) => api.put(`/api/prime/inventarios/${id}`, { stock_minimo: valor }),
    onSuccess: (_, { id }) => {
      setEditandoMinimo(prev => { const next = { ...prev }; delete next[id]; return next; });
      queryClient.invalidateQueries({ queryKey: ['prime-inventarios'] });
    },
    onError: (e) => setMsgInventario(e.message),
  });
  const guardarStockMinimo = (id) => {
    setMsgInventario('');
    const valor = Number(editandoMinimo[id]);
    if (!Number.isFinite(valor) || valor < 0) { setMsgInventario('stock_minimo inválido'); return; }
    guardarStockMinimoMutation.mutate({ id, valor });
  };

  return (
    <div>
      <div className="page-title">Prime</div>
      <div className="page-sub">Configuración avanzada — visible solo para el rol prime</div>

      <Tabs value={tab} onChange={setTab} mb="md">
        <Tabs.List>
          {TABS.map(t => <Tabs.Tab key={t.key} value={t.key}>{txt(t.label)}</Tabs.Tab>)}
        </Tabs.List>
      </Tabs>

      {tab === 'general' && (
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
                <Badge color={reconexionAuto ? 'teal' : 'red'} variant="light">{txt(reconexionAuto ? '✅ Activa' : '⛔ Inactiva')}</Badge>
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
        </div>
      )}

      {tab === 'sucursales' && (
        <Card withBorder radius="md" p="lg">
          <Title order={4} mb={4}>Sucursales</Title>
          <p className="page-sub" style={{ margin: '4px 0 16px' }}>
            Registro de tiendas/bodegas. Desactiva en vez de borrar si ya tiene movimientos de inventario.
          </p>
          {msgSucursales && <div className="login-error" style={{ marginBottom: 12 }}>{msgSucursales}</div>}
          <Group gap="xs" mb="md" align="flex-end" wrap="wrap">
            <TextInput placeholder="Nombre" {...sucursalForm.getInputProps('nombre')} style={{ flex: 1, minWidth: 160 }} />
            <TextInput placeholder="Código (opcional)" {...sucursalForm.getInputProps('codigo')} style={{ width: 140 }} />
            <TextInput placeholder="Dirección (opcional)" {...sucursalForm.getInputProps('direccion')} style={{ flex: 1, minWidth: 200 }} />
            <TextInput placeholder="C.P. (opcional)" {...sucursalForm.getInputProps('codigo_postal')} style={{ width: 110 }} />
            <Button disabled={!sucursalForm.values.nombre.trim()} onClick={crearSucursal}>Agregar</Button>
          </Group>
          <div className="table-wrap">
            <Table highlightOnHover verticalSpacing="xs">
              <thead><tr><th>Nombre</th><th>Código</th><th>Dirección</th><th>C.P.</th><th>Activa</th><th></th></tr></thead>
              <tbody>
                {sucursales.length === 0 && <tr><td colSpan={6} className="empty">Sin sucursales</td></tr>}
                {sucursales.map(s => (
                  <tr key={s.id}>
                    <td>{s.nombre}</td>
                    <td>{s.codigo || ''}</td>
                    <td>{s.direccion || ''}</td>
                    <td>{s.codigo_postal || ''}</td>
                    <td><Badge color={s.activa ? 'teal' : 'red'} variant="light">{s.activa ? 'sí' : 'no'}</Badge></td>
                    <td>
                      <Group gap={4} wrap="nowrap">
                        <ActionIcon variant="default" title="Editar" onClick={() => abrirEdicionSucursal(s)}>✏️</ActionIcon>
                        <ActionIcon variant="default" title={s.activa ? 'Desactivar' : 'Activar'} onClick={() => toggleSucursal(s.id, !s.activa)}>
                          {s.activa ? '⏸️' : '▶️'}
                        </ActionIcon>
                        <ActionIcon variant="default" color="red" title="Borrar" onClick={() => borrarSucursal(s.id)}>🗑️</ActionIcon>
                      </Group>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          {sucursalEditando && (
            <Modal title={`Editar — ${sucursalEditando.nombre}`} onClose={() => setSucursalEditando(null)}
              actions={<>
                <Button variant="default" onClick={() => setSucursalEditando(null)}>Cancelar</Button>
                <Button onClick={guardarEdicionSucursal}>Guardar</Button>
              </>}>
              {msgEditarSucursal && <div className="login-error" style={{ marginBottom: 12 }}>{msgEditarSucursal}</div>}
              <TextInput label="Nombre" {...editarSucursalForm.getInputProps('nombre')} mb="sm" />
              <Group grow mb="sm">
                <TextInput label="Código" {...editarSucursalForm.getInputProps('codigo')} />
                <TextInput label="Código postal" {...editarSucursalForm.getInputProps('codigo_postal')} />
              </Group>
              <TextInput label="Dirección" {...editarSucursalForm.getInputProps('direccion')} />
            </Modal>
          )}
        </Card>
      )}

      {tab === 'inventario' && (
        <Card withBorder radius="md" p="lg">
          <Group justify="space-between" mb={4} wrap="wrap">
            <Title order={4}>Inventario</Title>
            <Tabs value={vistaInventario} onChange={setVistaInventario}>
              <Tabs.List>
                <Tabs.Tab value="stock">Stock</Tabs.Tab>
                <Tabs.Tab value="historial">Historial de movimientos</Tabs.Tab>
              </Tabs.List>
            </Tabs>
          </Group>

          {vistaInventario === 'stock' ? (
            <>
              <p className="page-sub" style={{ margin: '4px 0 16px' }}>
                Elige una sucursal para acotar la vista (con {sucursales.length || 11} sucursales y cientos
                de productos, mostrar todo de golpe no es manejable). La columna "Stock mínimo" es el umbral
                que dispara la alerta automática al asesor cuando el stock cae a ese nivel o menos; en 0, la
                alerta queda desactivada para esa fila.
              </p>
              {msgInventario && <div className="login-error" style={{ marginBottom: 12 }}>{msgInventario}</div>}
              <Group gap="xs" mb="md" wrap="wrap">
                <Select
                  placeholder="Todas las sucursales"
                  data={sucursales.map(s => ({ value: s.nombre, label: s.nombre }))}
                  value={sucursalInventario || null}
                  onChange={v => { setSucursalInventario(v || ''); setPaginaInventario(1); setPaginaMovimientos(1); }}
                  clearable
                  style={{ minWidth: 220 }}
                />
                <TextInput
                  placeholder="Buscar producto..."
                  value={buscarInventario}
                  onChange={e => { setBuscarInventario(e.target.value); setPaginaInventario(1); }}
                  style={{ flex: 1, minWidth: 200 }}
                />
              </Group>
              <div className="table-wrap">
                <Table highlightOnHover verticalSpacing="xs">
                  <thead><tr><th>Producto</th><th>Sucursal</th><th>Stock</th><th>Stock mínimo</th><th></th></tr></thead>
                  <tbody>
                    {inventarios.length === 0 && <tr><td colSpan={5} className="empty">Sin resultados</td></tr>}
                    {inventarios.map(i => (
                      <tr key={i.id}>
                        <td>{i.producto}</td>
                        <td>{i.sucursal}</td>
                        <td>{i.stock}</td>
                        <td>
                          <NumberInput
                            min={0}
                            size="xs"
                            style={{ width: 90 }}
                            value={Number(editandoMinimo[i.id] ?? i.stock_minimo)}
                            onChange={v => setEditandoMinimo(prev => ({ ...prev, [i.id]: v }))}
                          />
                        </td>
                        <td><Button size="xs" variant="default" onClick={() => guardarStockMinimo(i.id)}>Guardar</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              {totalPaginasInventario > 1 && (
                <Group justify="center" mt="md">
                  <Pagination total={totalPaginasInventario} value={paginaInventario} onChange={setPaginaInventario} size="sm" />
                </Group>
              )}
            </>
          ) : (
            <>
              <p className="page-sub" style={{ margin: '4px 0 16px' }}>
                Quién y cuándo se dio de alta cada producto en cada sucursal, o se ajustó su stock
                mínimo (auditoría — inspirado en StockItemTracking de InvenTree). El filtro de
                sucursal de arriba también aplica aquí.
              </p>
              <div className="table-wrap">
                <Table highlightOnHover verticalSpacing="xs">
                  <thead><tr><th>Fecha</th><th>Producto</th><th>Sucursal</th><th>Tipo</th><th>Antes</th><th>Después</th><th>Por</th></tr></thead>
                  <tbody>
                    {movimientos.length === 0 && <tr><td colSpan={7} className="empty">Sin movimientos registrados</td></tr>}
                    {movimientos.map(m => (
                      <tr key={m.id}>
                        <td>{m.creado_en}</td>
                        <td>{m.producto || `#${m.id_producto}`}</td>
                        <td>{m.sucursal}</td>
                        <td>
                          <Badge color={m.tipo === 'alta' ? 'teal' : 'blue'} variant="light">
                            {m.tipo === 'alta' ? 'alta' : m.tipo === 'ajuste_minimo' ? 'ajuste mínimo' : 'ajuste stock'}
                          </Badge>
                        </td>
                        <td>{m.cantidad_anterior ?? '-'}</td>
                        <td>{m.cantidad_nueva ?? '-'}</td>
                        <td>{m.creado_por || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              {totalPaginasMovimientos > 1 && (
                <Group justify="center" mt="md">
                  <Pagination total={totalPaginasMovimientos} value={paginaMovimientos} onChange={setPaginaMovimientos} size="sm" />
                </Group>
              )}
            </>
          )}
        </Card>
      )}

      {tab === 'catalogo' && (
        <div>
          <Card withBorder radius="md" p="lg" mb={20}>
            <Title order={4} mb={4}>Alta de producto</Title>
            <p className="page-sub" style={{ margin: '4px 0 16px' }}>
              Agrega un producto puntual al catálogo (la carga masiva sigue siendo aparte). Todas las
              columnas reales del catálogo están aquí — las que el bot no usa todavía quedan marcadas.
            </p>
            {msgProducto && <div style={{ marginBottom: 12 }}>{msgProducto}</div>}

            {renderCamposProducto(productoForm, mostrarNuevaCategoria, setMostrarNuevaCategoria, categoriaNuevaNombre, setCategoriaNuevaNombre)}

            <Fieldset legend="Stock inicial (tabla inventarios)" mb="md">
              <p className="page-sub" style={{ margin: '0 0 12px' }}>
                Solo aplica al crear: siembra una fila en `inventarios` para la sucursal de facturación
                default ({sucursales.find(s => String(s.id) === sucursalFacturacion)?.nombre || 'sin configurar — ve a Prime > General'}),
                para que el producto sea visible desde el día 1. La venta multi-sucursal ya funciona
                sola después (pedido_detalle.sucursal_origen), no depende de esta siembra inicial.
              </p>
              <NumberInput
                label="Stock inicial" min={0} style={{ maxWidth: 200 }}
                value={Number(stockInicial)}
                onChange={v => setStockInicial(String(v ?? 0))}
              />
            </Fieldset>

            <Button onClick={crearProducto}>Crear producto</Button>
          </Card>

          <Card withBorder radius="md" p="lg">
            <Title order={4} mb={4}>Productos existentes</Title>
            <p className="page-sub" style={{ margin: '4px 0 16px' }}>
              {productosResp?.total ?? 0} producto(s) en el catálogo.
            </p>
            <TextInput
              placeholder="Buscar por nombre o SKU..."
              value={buscarCatalogo}
              onChange={e => { setBuscarCatalogo(e.target.value); setPaginaCatalogo(1); }}
              mb="md"
            />
            <div className="table-wrap">
              <Table highlightOnHover verticalSpacing="xs">
                <thead><tr><th>SKU</th><th>Nombre</th><th>Categoría</th><th>Marca</th><th>Precio</th><th>Edad</th><th>Tienda</th><th>CEDIS</th><th>SLP</th><th></th></tr></thead>
                <tbody>
                  {productosLista.length === 0 && <tr><td colSpan={10} className="empty">Sin resultados</td></tr>}
                  {productosLista.map(p => (
                    <tr key={p.id}>
                      <td>{p.sku || '-'}</td>
                      <td>{p.name}</td>
                      <td>{p.categoria_nombre || p.cat || '-'}</td>
                      <td>{p.brand || '-'}</td>
                      <td>${p.price}</td>
                      <td>{p.edad_recomendada || '-'}</td>
                      <td>{p.stock_tienda}</td>
                      <td>{p.stock_cedis}</td>
                      <td>{p.stock_san_luis_potosi}</td>
                      <td><ActionIcon variant="default" title="Editar" onClick={() => abrirEdicionProducto(p)}>✏️</ActionIcon></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            {totalPaginasCatalogo > 1 && (
              <Group justify="center" mt="md">
                <Pagination total={totalPaginasCatalogo} value={paginaCatalogo} onChange={setPaginaCatalogo} size="sm" />
              </Group>
            )}
          </Card>

          {productoEditando && (
            <Modal title={`Editar — ${productoEditando.name}`} onClose={() => setProductoEditando(null)}
              actions={<>
                <Button variant="default" onClick={() => setProductoEditando(null)}>Cancelar</Button>
                <Button onClick={guardarEdicionProducto}>Guardar</Button>
              </>}>
              {msgEditarProducto && <div className="login-error" style={{ marginBottom: 12 }}>{msgEditarProducto}</div>}
              {renderCamposProducto(editarForm, mostrarNuevaCategoriaEditar, setMostrarNuevaCategoriaEditar, categoriaNuevaNombreEditar, setCategoriaNuevaNombreEditar)}
            </Modal>
          )}
        </div>
      )}

      {tab === 'usuarios' && (
        <Card withBorder radius="md" p="lg">
          <Title order={4} mb={4}>Usuarios del dashboard</Title>
          <p className="page-sub" style={{ margin: '4px 0 16px' }}>
            Crea cuentas con rol admin (operación) o prime (acceso total). No puedes borrar tu propia
            cuenta ni dejar el sistema sin ningún usuario prime.
          </p>
          {msgUsuarios && <div className="login-error" style={{ marginBottom: 12 }}>{msgUsuarios}</div>}
          <Group gap="xs" mb="md" align="flex-end" wrap="wrap">
            <TextInput placeholder="Usuario" {...usuarioForm.getInputProps('username')} style={{ minWidth: 160 }} />
            <PasswordInput placeholder="Password (mín. 8)" {...usuarioForm.getInputProps('password')} style={{ minWidth: 160 }} />
            <Select data={[{ value: 'admin', label: 'admin' }, { value: 'prime', label: 'prime' }]}
              allowDeselect={false} {...usuarioForm.getInputProps('rol')} />
            <Button disabled={!usuarioForm.values.username.trim() || !usuarioForm.values.password} onClick={crearUsuario}>
              Crear usuario
            </Button>
          </Group>
          <div className="table-wrap">
            <Table highlightOnHover verticalSpacing="xs">
              <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Creado</th><th></th></tr></thead>
              <tbody>
                {usuarios.length === 0 && <tr><td colSpan={5} className="empty">Sin usuarios</td></tr>}
                {usuarios.map(u => (
                  <tr key={u.id}>
                    <td>{u.username}</td>
                    <td>{u.nombre || '—'}</td>
                    <td>
                      <Select
                        size="xs"
                        data={[{ value: 'admin', label: 'admin' }, { value: 'prime', label: 'prime' }]}
                        value={u.rol}
                        onChange={v => v && cambiarRolUsuario(u.id, v)}
                        allowDeselect={false}
                        comboboxProps={{ withinPortal: true }}
                      />
                    </td>
                    <td>{u.creado_en}</td>
                    <td>
                      <Group gap={4} wrap="nowrap">
                        <ActionIcon variant="default" title="Editar" onClick={() => abrirEdicionUsuario(u)}>✏️</ActionIcon>
                        <ActionIcon variant="default" color="red" title="Borrar" onClick={() => borrarUsuario(u.id)}>🗑️</ActionIcon>
                      </Group>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          {usuarioEditando && (
            <Modal title={`Editar — ${usuarioEditando.username}`} onClose={() => setUsuarioEditando(null)}
              actions={<>
                <Button variant="default" onClick={() => setUsuarioEditando(null)}>Cancelar</Button>
                <Button onClick={guardarEdicionUsuario}>Guardar</Button>
              </>}>
              {msgEditarUsuario && <div className="login-error" style={{ marginBottom: 12 }}>{msgEditarUsuario}</div>}
              <TextInput label="Nombre" {...editarUsuarioForm.getInputProps('nombre')} mb="sm" />
              <PasswordInput label="Nueva contraseña (dejar vacío para no cambiar)" {...editarUsuarioForm.getInputProps('password')} />
            </Modal>
          )}
        </Card>
      )}

      {tab === 'filtros' && (
        <Card withBorder radius="md" p="lg">
          <Title order={4} mb={4}>Lista negra y frases de queja</Title>
          <p className="page-sub" style={{ margin: '4px 0 16px' }}>
            Las palabras marcadas "código fuente" son fijas y no se pueden borrar ni desactivar —
            ya las aplica el bot siempre. Agrega aquí palabras nuevas para enriquecerlas;
            el bot las toma en cuenta automáticamente (refresco cada 60s).
          </p>
          {msgFiltro && <div className="login-error" style={{ marginBottom: 12 }}>{msgFiltro}</div>}

          <Group gap="xs" mb="md" align="flex-end" wrap="wrap">
            <Select
              data={CATEGORIAS_FILTRO.map(c => ({ value: c.valor, label: c.etiqueta }))}
              value={nuevaCategoria}
              onChange={v => v && setNuevaCategoria(v)}
              allowDeselect={false}
              style={{ minWidth: 260 }}
            />
            <TextInput
              placeholder="palabra o frase"
              value={nuevaPalabra}
              onChange={e => setNuevaPalabra(e.target.value)}
              style={{ flex: 1, minWidth: 200 }}
            />
            {nuevaCategoria === 'risk' && (
              <NumberInput min={1} max={10} value={Number(nuevosPuntos)} onChange={v => setNuevosPuntos(String(v))} title="Puntos de riesgo" style={{ width: 90 }} />
            )}
            <Button disabled={!nuevaPalabra.trim()} onClick={agregarPalabra}>Agregar</Button>
          </Group>

          <Group gap="md" mb="md" wrap="wrap">
            <Select
              label="Ver categoría"
              data={[{ value: 'todas', label: 'Todas las categorías' }, ...CATEGORIAS_FILTRO.map(c => ({ value: c.valor, label: c.etiqueta }))]}
              value={categoriaVistaFiltros}
              onChange={v => v && setCategoriaVistaFiltros(v)}
              allowDeselect={false}
              style={{ minWidth: 260 }}
            />
            <Switch
              label="Mostrar también las de código fuente (fijas, no editables)"
              checked={mostrarCodigoFuente}
              onChange={e => setMostrarCodigoFuente(e.target.checked)}
              mt={22}
            />
          </Group>

          <div className="table-wrap">
            <Table highlightOnHover verticalSpacing="xs">
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
                {palabrasFiltradas.length === 0 && <tr><td colSpan={6} className="empty">Sin palabras en esta vista</td></tr>}
                {palabrasFiltradas.map((p, i) => (
                  <tr key={p.id ?? `base-${i}`}>
                    <td>{p.categoria}</td>
                    <td>{p.palabra}</td>
                    <td>{p.puntos ?? ''}</td>
                    <td>{p.origen === 'codigo_fuente' ? 'código fuente' : 'agregado'}</td>
                    <td><Badge color={p.activo ? 'teal' : 'red'} variant="light">{p.activo ? 'sí' : 'no'}</Badge></td>
                    <td>
                      {p.origen === 'dashboard' && (
                        <Group gap={4} wrap="nowrap">
                          <ActionIcon variant="default" title={p.activo ? 'Desactivar' : 'Activar'} onClick={() => togglePalabra(p.id, !p.activo)}>
                            {p.activo ? '⏸️' : '▶️'}
                          </ActionIcon>
                          <ActionIcon variant="default" color="red" title="Borrar" onClick={() => eliminarPalabra(p.id)}>🗑️</ActionIcon>
                        </Group>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
