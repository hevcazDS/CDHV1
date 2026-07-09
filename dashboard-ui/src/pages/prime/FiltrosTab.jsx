// FiltrosTab.jsx — Tab "Filtros" de Prime: lista negra y frases de queja que
// el bot aplica (refresco cada 60s). Las de "código fuente" son fijas.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Title, Group, ActionIcon, Table, Badge, Switch, Select, TextInput, NumberInput, Button } from '@mantine/core';
import { api } from '../../api';

const CATEGORIAS_FILTRO = [
  { valor: 'bw_word',   etiqueta: 'Lista negra — palabra corta (match exacto)' },
  { valor: 'bw_long',   etiqueta: 'Lista negra — frase larga (substring)' },
  { valor: 'risk',      etiqueta: 'Riesgo (puntos acumulables)' },
  { valor: 'queja_l1',  etiqueta: 'Queja — nivel 1' },
  { valor: 'queja_l2',  etiqueta: 'Queja — nivel 2 (pedir humano)' },
];

export default function FiltrosTab() {
  const queryClient = useQueryClient();
  const [nuevaCategoria, setNuevaCategoria] = useState('bw_word');
  const [nuevaPalabra, setNuevaPalabra] = useState('');
  const [nuevosPuntos, setNuevosPuntos] = useState('1');
  const [msgFiltro, setMsgFiltro] = useState('');
  const [categoriaVistaFiltros, setCategoriaVistaFiltros] = useState('todas');
  const [mostrarCodigoFuente, setMostrarCodigoFuente] = useState(false);

  const { data: palabras = [] } = useQuery({
    queryKey: ['prime-palabras-filtro'],
    queryFn: () => api.get('/api/prime/palabras-filtro').then(d => d.items || []),
  });

  const palabrasFiltradas = palabras.filter(p => {
    if (!mostrarCodigoFuente && p.origen === 'codigo_fuente') return false;
    if (categoriaVistaFiltros !== 'todas' && p.categoria !== categoriaVistaFiltros) return false;
    return true;
  });

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

  return (
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
                        {p.activo ? '⏸' : '▶'}
                      </ActionIcon>
                      <ActionIcon variant="default" color="red" title="Borrar" onClick={() => eliminarPalabra(p.id)}><Trash2 size={16} strokeWidth={1.75} /></ActionIcon>
                    </Group>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Card>
  );
}
