import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Group, Stack, Text, Title, TextInput, NumberInput, Select, Button, Table, Badge, Skeleton } from '@mantine/core';
import { api } from '../../api';
import { money } from '../../lib/format';
import { handleApiError } from '../../lib/apiError';
import { confirmar, prompt } from '../../lib/ui';
import { useTextoEmoji } from '../../context/EmojiContext';

// Activos fijos: capitalización + depreciación lineal. Equipo/cómputo/vehículos/
// maquinaria/inmuebles se registran en su cuenta 12x (no en inventario de venta)
// y se deprecian contra 129/605. Ver services/activosFijosService.js.
const CATEGORIAS = [
  { value: 'equipo', label: '🏋️ Mobiliario y equipo' },
  { value: 'computo', label: '💻 Equipo de cómputo' },
  { value: 'vehiculos', label: '🚚 Vehículos' },
  { value: 'maquinaria', label: '⚙️ Maquinaria' },
  { value: 'inmuebles', label: '🏢 Inmuebles' },
  { value: 'terrenos', label: '🏞️ Terrenos (no se deprecian)' },
];
const CAT_LABEL = Object.fromEntries(CATEGORIAS.map(c => [c.value, c.label]));

export default function ActivosFijosTab() {
  const txt = useTextoEmoji();
  const categoriasTxt = CATEGORIAS.map(c => ({ ...c, label: txt(c.label) }));
  const qc = useQueryClient();
  const [f, setF] = useState({ nombre: '', categoria: 'equipo', costo: '', vida_util_meses: 60, valor_residual: '', metodo: 'bancos' });
  const { data: activos, isLoading } = useQuery({ queryKey: ['activos-fijos'], queryFn: () => api.get('/api/erp/activos') });

  const alta = useMutation({
    mutationFn: () => api.post('/api/erp/activos', { ...f, costo: Number(f.costo), valor_residual: Number(f.valor_residual) || 0 }),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); setF({ nombre: '', categoria: 'equipo', costo: '', vida_util_meses: 60, valor_residual: '', metodo: 'bancos' }); qc.invalidateQueries({ queryKey: ['activos-fijos'] }); },
    onError: handleApiError,
  });
  const depreciar = useMutation({
    mutationFn: () => api.post('/api/erp/activos/depreciar', {}),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['activos-fijos'] }); },
    onError: handleApiError,
  });
  const baja = useMutation({
    mutationFn: ({ id, motivo }) => api.post(`/api/erp/activos/${id}/baja`, { motivo }),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); qc.invalidateQueries({ queryKey: ['activos-fijos'] }); },
    onError: handleApiError,
  });
  const darBaja = async (a) => {
    if (!(await confirmar(`¿Dar de baja "${a.nombre}"? Se sacará de libros (valor en libros ${money(a.valor_en_libros)}).`))) return;
    const motivo = await prompt('Motivo de la baja (opcional):', '');
    baja.mutate({ id: a.id, motivo: motivo || '' });
  };
  const revaluar = useMutation({
    mutationFn: ({ id, nuevo_valor }) => api.post(`/api/erp/activos/${id}/revaluar`, { nuevo_valor }),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); qc.invalidateQueries({ queryKey: ['activos-fijos'] }); },
    onError: handleApiError,
  });
  const hacerRevaluar = async (a) => {
    // Revaluación SOLO al alza (plusvalía de inmuebles/terrenos). El backend
    // valida que el nuevo valor supere el valor en libros.
    const val = await prompt(`Nuevo valor de "${a.nombre}" (valor en libros actual: ${money(a.valor_en_libros)}). Solo al alza:`, String(a.valor_en_libros || ''));
    const n = Number(val);
    if (!(n > 0)) return;
    revaluar.mutate({ id: a.id, nuevo_valor: n });
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Title order={4}>Activos fijos</Title>
        <Button variant="default" loading={depreciar.isPending} onClick={() => depreciar.mutate()}>Depreciar este mes</Button>
      </Group>

      <Card withBorder radius="md" p="md" className="card">
        <Text size="sm" fw={600} mb="xs">Registrar un activo (se capitaliza y deprecia — no entra al inventario de venta)</Text>
        <Group align="flex-end" gap="sm" wrap="wrap">
          <TextInput label="Nombre" placeholder="Ej: Caminadora Life Fitness" value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} w={220} />
          <Select label="Categoría" data={categoriasTxt} value={f.categoria} onChange={v => setF({ ...f, categoria: v })} w={190} />
          <NumberInput label="Costo" min={0} prefix="$ " thousandSeparator="," value={f.costo} onChange={v => setF({ ...f, costo: v })} w={130} />
          <NumberInput label="Vida útil (meses)" min={1} value={f.vida_util_meses} onChange={v => setF({ ...f, vida_util_meses: v })} w={130} />
          <NumberInput label="Valor residual" min={0} prefix="$ " thousandSeparator="," value={f.valor_residual} onChange={v => setF({ ...f, valor_residual: v })} w={130} />
          <Select label="Pagado con" data={[{ value: 'bancos', label: 'Bancos' }, { value: 'caja', label: 'Caja' }]} value={f.metodo} onChange={v => setF({ ...f, metodo: v })} w={120} />
          <Button loading={alta.isPending} disabled={!f.nombre.trim() || !(Number(f.costo) > 0)} onClick={() => alta.mutate()}>Registrar</Button>
        </Group>
      </Card>

      <Card withBorder radius="md" p="md" className="card">
        {isLoading ? <Skeleton height={160} radius="md" /> : (
          <Table highlightOnHover verticalSpacing="xs">
            <thead>
              <tr><th>Activo</th><th>Categoría</th><th style={{ textAlign: 'right' }}>Costo</th><th style={{ textAlign: 'right' }}>Depreciación acum.</th><th style={{ textAlign: 'right' }}>Valor en libros</th><th></th></tr>
            </thead>
            <tbody>
              {(activos || []).length === 0 && <tr><td colSpan={6}><Text size="sm" c="dimmed" ta="center">Aún no hay activos registrados.</Text></td></tr>}
              {(activos || []).map(a => (
                <tr key={a.id}>
                  <td>{a.nombre}</td>
                  <td><Badge variant="light" size="sm">{txt(CAT_LABEL[a.categoria] || a.categoria)}</Badge></td>
                  <td style={{ textAlign: 'right' }}>{money(a.costo)}</td>
                  <td style={{ textAlign: 'right' }}>{money(a.depreciacion_acumulada)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <b>{money(a.valor_en_libros)}</b>
                    {a.revaluacion_acumulada > 0 && <Text span size="xs" c="dimmed"> (revaluado +{money(a.revaluacion_acumulada)})</Text>}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Button size="compact-xs" variant="subtle" onClick={() => hacerRevaluar(a)}>Revaluar</Button>
                    <Button size="compact-xs" variant="subtle" color="red" onClick={() => darBaja(a)}>Baja</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Text size="xs" c="dimmed" mt="xs">La depreciación mensual es lineal: (costo − valor residual) ÷ vida útil, y ya corre sola cada mes (idempotente). Los <b>terrenos no se deprecian</b>. Usa <b>Revaluar</b> para reconocer plusvalía al alza de inmuebles/terrenos (superávit por revaluación, no afecta resultados).</Text>
      </Card>
    </Stack>
  );
}
