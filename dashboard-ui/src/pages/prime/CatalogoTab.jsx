// CatalogoTab.jsx — Tab "Catálogo" de Prime: alta de producto, lista/búsqueda
// de productos existentes, edición y entrada de mercancía (recibir stock).
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@mantine/form';
import { Card, Title, Group, ActionIcon, Table, TextInput, NumberInput, Select, Button, Fieldset, Pagination } from '@mantine/core';
import { api } from '../../api';
import Modal from '../../components/Modal';
import { CamposProducto, armarDatosProducto, PRODUCTO_VACIO, srcImagenProducto } from './productoCampos';
import VariantesModal from './VariantesModal';
import { Shirt, Inbox, Pencil } from 'lucide-react';

export default function CatalogoTab() {
  const queryClient = useQueryClient();

  const productoForm = useForm({ initialValues: PRODUCTO_VACIO });
  const [variantesDe, setVariantesDe] = useState(null);
  const [msgProducto, setMsgProducto] = useState('');
  const [stockInicial, setStockInicial] = useState('0');

  const [buscarCatalogo, setBuscarCatalogo] = useState('');
  const [paginaCatalogo, setPaginaCatalogo] = useState(1);
  const [productoEditando, setProductoEditando] = useState(null);
  const editarForm = useForm({ initialValues: PRODUCTO_VACIO });
  const [msgEditarProducto, setMsgEditarProducto] = useState('');

  const { data: sucursales = [] } = useQuery({
    queryKey: ['prime-sucursales'],
    queryFn: () => api.get('/api/prime/sucursales'),
  });
  const { data: categorias = [] } = useQuery({
    queryKey: ['prime-categorias'],
    queryFn: () => api.get('/api/prime/categorias'),
  });
  const { data: sucursalFacturacion = '' } = useQuery({
    queryKey: ['prime-sucursal-facturacion-default'],
    queryFn: () => api.get('/api/prime/sucursal-facturacion-default').then(d => d.id_sucursal ? String(d.id_sucursal) : '').catch(() => ''),
  });

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

  // Categoría "crear nueva" — fija id_categoria Y cat al mismo valor.
  const crearCategoriaMutation = useMutation({
    mutationFn: (nombre) => api.post('/api/prime/categorias', { nombre }),
  });
  const crearCategoriaYAsignar = (nombre, form, done) => {
    if (!nombre.trim()) return;
    crearCategoriaMutation.mutate(nombre.trim(), {
      onSuccess: (r) => {
        queryClient.invalidateQueries({ queryKey: ['prime-categorias'] });
        form.setValues(v => ({ ...v, id_categoria: r.id, cat: r.nombre }));
        done();
      },
    });
  };

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
    if (!v.name.trim() || !v.price) { setMsgProducto('Nombre y precio son obligatorios.'); return; }
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
    editarForm.setValues({
      name: p.name || '', price: String(p.price ?? 0), costo: p.costo == null ? '' : String(p.costo),
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

  // ── Entrada de mercancía (Bloque 2B) ──────────────────────────────────
  const [entradaProd, setEntradaProd] = useState(null);
  const [entradaSucursal, setEntradaSucursal] = useState('');
  const [entradaCantidad, setEntradaCantidad] = useState('');
  const [entradaCosto, setEntradaCosto] = useState('');
  const [entradaProveedor, setEntradaProveedor] = useState('');
  const [msgEntrada, setMsgEntrada] = useState('');
  const abrirEntrada = (p) => {
    setEntradaProd(p); setMsgEntrada('');
    setEntradaSucursal(''); setEntradaCantidad('');
    setEntradaCosto(p.costo == null ? '' : String(p.costo)); setEntradaProveedor('');
  };
  const entradaMutation = useMutation({
    mutationFn: () => api.post('/api/prime/entrada-mercancia', {
      id_producto: entradaProd.id, sucursal: entradaSucursal, cantidad: Number(entradaCantidad),
      costo: entradaCosto === '' ? undefined : Number(entradaCosto),
      proveedor: entradaProveedor || undefined,
    }),
    onSuccess: (d) => {
      setMsgEntrada(`Stock actualizado: ${d.stock_anterior} → ${d.stock_nuevo} en ${d.sucursal}.`);
      queryClient.invalidateQueries({ queryKey: ['prime-productos-lista'] });
      queryClient.invalidateQueries({ queryKey: ['prime-inventarios'] });
      queryClient.invalidateQueries({ queryKey: ['prime-inventario-movimientos'] });
    },
    onError: (e) => setMsgEntrada(e.message),
  });
  const guardarEntrada = () => {
    setMsgEntrada('');
    if (!entradaSucursal) { setMsgEntrada('Elige la sucursal.'); return; }
    if (!(Number(entradaCantidad) > 0)) { setMsgEntrada('La cantidad debe ser mayor a 0.'); return; }
    entradaMutation.mutate();
  };

  return (
    <div>
      <Card withBorder radius="md" p="lg" mb={20}>
        <Title order={4} mb={4}>Alta de producto</Title>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Agrega un producto puntual al catálogo (la carga masiva sigue siendo aparte). Todas las
          columnas reales del catálogo están aquí — las que el bot no usa todavía quedan marcadas.
        </p>
        {msgProducto && <div style={{ marginBottom: 12 }}>{msgProducto}</div>}

        <CamposProducto form={productoForm} categorias={categorias} onCrearCategoria={crearCategoriaYAsignar} />

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
            <thead><tr><th>SKU</th><th>Nombre</th><th>Categoría</th><th>Marca</th><th>Precio</th><th>Costo</th><th>Margen</th><th>Tienda</th><th>CEDIS</th><th></th></tr></thead>
            <tbody>
              {productosLista.length === 0 && <tr><td colSpan={10} className="empty">Sin resultados</td></tr>}
              {productosLista.map(p => {
                const margen = (p.costo != null && p.price != null) ? (p.price - p.costo) : null;
                const pct = (margen != null && p.price > 0) ? (margen / p.price * 100) : null;
                return (
                <tr key={p.id}>
                  <td>{p.sku || '-'}</td>
                  <td>
                    <Group gap={6} wrap="nowrap">
                      {srcImagenProducto(p.url_imagen) && <img src={srcImagenProducto(p.url_imagen)} alt="" width={28} height={28} style={{ objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />}
                      <span>{p.name}</span>
                    </Group>
                  </td>
                  <td>{p.categoria_nombre || p.cat || '-'}</td>
                  <td>{p.brand || '-'}</td>
                  <td>${p.price}</td>
                  <td>{p.costo == null ? '-' : `$${p.costo}`}</td>
                  <td style={{ color: margen == null ? 'var(--text-mute)' : margen >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {margen == null ? '-' : `$${margen.toFixed(2)} (${pct.toFixed(0)}%)`}
                  </td>
                  <td>{p.stock_tienda}</td>
                  <td>{p.stock_cedis}</td>
                  <td>
                    <Group gap={4} wrap="nowrap">
                      <ActionIcon variant="light" color="teal" title="Recibir mercancía (entrada de stock)" onClick={() => abrirEntrada(p)}><Inbox size={16} strokeWidth={1.75} /></ActionIcon>
                      <ActionIcon variant="light" color="grape" title="Tallas y colores (variantes por sucursal)" onClick={() => setVariantesDe(p)}><Shirt size={16} strokeWidth={1.75} /></ActionIcon>
                      <ActionIcon variant="default" title="Editar" onClick={() => abrirEdicionProducto(p)}><Pencil size={16} strokeWidth={1.75} /></ActionIcon>
                    </Group>
                  </td>
                </tr>
              );})}
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
          <CamposProducto form={editarForm} categorias={categorias} onCrearCategoria={crearCategoriaYAsignar} idProducto={productoEditando?.id} />
        </Modal>
      )}

      {entradaProd && (
        <Modal title={`Recibir mercancía — ${entradaProd.name}`} onClose={() => setEntradaProd(null)}
          actions={<>
            <Button variant="default" onClick={() => setEntradaProd(null)}>Cerrar</Button>
            <Button onClick={guardarEntrada} disabled={entradaMutation.isPending}>Registrar entrada</Button>
          </>}>
          {msgEntrada && <div className={msgEntrada.startsWith('Stock actualizado') ? 'card' : 'login-error'} style={{ marginBottom: 12, fontSize: 13 }}>{msgEntrada}</div>}
          <Select label="Sucursal" placeholder="¿A qué sucursal entra?" mb="sm"
            data={sucursales.filter(s => s.activa).map(s => ({ value: s.nombre, label: s.nombre }))}
            value={entradaSucursal} onChange={v => setEntradaSucursal(v || '')} searchable />
          <NumberInput label="Cantidad recibida" min={1} mb="sm" value={entradaCantidad} onChange={setEntradaCantidad} />
          <TextInput label="Costo unitario (opcional, actualiza el costo del producto)" type="number" min={0} step="0.01"
            value={entradaCosto} onChange={e => setEntradaCosto(e.target.value)} mb="sm" />
          <TextInput label="Proveedor (opcional)" value={entradaProveedor} onChange={e => setEntradaProveedor(e.target.value)} />
          <p className="page-sub" style={{ fontSize: 11, marginTop: 10 }}>Suma al stock de esa sucursal y queda registrado en el historial de movimientos.</p>
        </Modal>
      )}
      {variantesDe && <VariantesModal producto={variantesDe} onClose={() => setVariantesDe(null)} />}
    </div>
  );
}
