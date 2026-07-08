// productoCampos.jsx — Constantes + componentes de formulario de producto,
// compartidos entre el alta y la edición en CatalogoTab (ambos tocan
// exactamente las mismas columnas reales de `productos`).
import { useState } from 'react';
import { Fieldset, TextInput, NumberInput, Select, Textarea, Group, Button } from '@mantine/core';

export const CATEGORIA_NUEVA = '__nueva__';

// Valores reales que entiende el wizard de recomendación (bot/flows/_shared.js
// generoMap/tipoMap + bot/flows/menuFlow.js).
export const GENERO_OPTIONS = [
  { value: 'nino', label: 'Niño' },
  { value: 'nina', label: 'Niña' },
  { value: 'unisex', label: 'Unisex' },
];
export const TIPO_JUGUETE_OPTIONS = [
  { value: 'diversion', label: 'Diversión' },
  { value: 'educativo', label: 'Educativo' },
  { value: 'creativo', label: 'Creativo' },
  { value: 'coleccionable', label: 'Coleccionable' },
  { value: 'peluche', label: 'Peluche' },
];

export const PRODUCTO_VACIO = {
  tipo: 'fisico',
  name: '', price: '', costo: '', sku: '', upc: '', brand: '', handle: '',
  cat: '', id_categoria: null,
  genero: '', tipo_juguete: '', edad_min: 0, edad_max: 99,
  peso_kg: '', alto_cm: '', ancho_cm: '', largo_cm: '',
  url_imagen: '', description: '', seo_description: '', tags: '', material: '', color: '', target_audience: '',
  stock_tienda: '0', stock_cedis: '0', stock_san_luis_potosi: '0',
  stock_exhibicion: '0', stock_queretaro: '0', stock_monterrey: '0', stock_cdmx_centro: '0', stock_base: '0',
};

// Mapeo único de los valores de form (alta y edición comparten exactamente
// las mismas columnas reales de `productos`) al payload que espera la API.
// edad_recomendada NO se manda: el servidor la calcula desde edad_min/max.
export function armarDatosProducto(v) {
  return {
    tipo: v.tipo || 'fisico',
    name: v.name,
    price: Number(v.price),
    costo: (v.costo === '' || v.costo == null) ? undefined : Number(v.costo),
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
  };
}

// Select de categoría con opción inline "crear nueva". El estado de creación
// es interno a cada instancia (alta y edición tienen el suyo). Al crear, fija
// id_categoria Y cat (texto legacy que usa bot/flows/_shared.js) al mismo
// valor para no desincronizarlos. onCrearCategoria(nombre, form, done).
export function SelectCategoria({ form, categorias, onCrearCategoria }) {
  const [mostrarNueva, setMostrarNueva] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const done = () => { setNombreNuevo(''); setMostrarNueva(false); };
  return (
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
          <Button size="xs" onClick={() => onCrearCategoria(nombreNuevo, form, done)}>Crear</Button>
          <Button size="xs" variant="default" onClick={done}>Cancelar</Button>
        </Group>
      )}
    </div>
  );
}

// Bloque de Fieldsets compartido entre Alta y Edición de producto — ambos
// tocan exactamente las mismas columnas reales de `productos` (decisión
// explícita: exponer todas de una vez, no por etapas).
export function CamposProducto({ form, categorias, onCrearCategoria }) {
  return (
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
          <Select label="Tipo" allowDeselect={false} data={[
            { value: 'fisico', label: 'Físico (inventariable/enviable)' },
            { value: 'consumible', label: 'Consumible (insumo con stock)' },
            { value: 'servicio', label: 'Servicio (sin stock ni envío)' },
          ]} {...form.getInputProps('tipo')} />
          <SelectCategoria form={form} categorias={categorias} onCrearCategoria={onCrearCategoria} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <TextInput label="Costo" type="number" min={0} step="0.01" placeholder="Costo (opcional)" {...form.getInputProps('costo')} />
          {(() => {
            const pr = Number(form.values.price), co = Number(form.values.costo);
            if (!(pr > 0) || !(co >= 0) || form.values.costo === '') return <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>Captura el costo para ver tu margen.</div>;
            const margen = pr - co; const pct = pr > 0 ? (margen / pr * 100) : 0;
            return <div style={{ fontSize: 13 }}>Margen: <strong style={{ color: margen >= 0 ? 'var(--green)' : 'var(--red)' }}>${margen.toFixed(2)} ({pct.toFixed(0)}%)</strong></div>;
          })()}
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
}
