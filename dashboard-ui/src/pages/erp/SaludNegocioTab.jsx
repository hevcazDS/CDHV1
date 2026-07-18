import { useState, lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Group, Stack, Text, Title, NumberInput, Button, RingProgress, Badge, Table, TextInput, Skeleton } from '@mantine/core';
import { api } from '../../api';
import { money } from '../../lib/format';

// Salud del negocio (unit economics): CAC / LTV / Ratio LTV:CAC. El gasto de
// adquisición (publicidad + ventas) es OPCIONAL — muchos negocios no pautan: si
// se deja en 0 el bot reporta "adquisición orgánica", no un error. Recharts va
// por el wrapper lazy (regla del repo); el semáforo es Mantine RingProgress.
const BarrasH = lazy(() => import('../../components/MiniCharts').then(m => ({ default: m.BarrasH })));

const COLOR = { escalable: 'teal', saludable: 'green', alerta: 'red', sin_datos: 'gray' };
const _hoy = () => new Date().toISOString().slice(0, 10);
const _iniMes = () => _hoy().slice(0, 8) + '01';

export default function SaludNegocioTab() {
  const [desde, setDesde] = useState(_iniMes());
  const [hasta, setHasta] = useState(_hoy());
  const [gasto, setGasto] = useState('');            // '' = usa configuracion o sin_datos
  const [gastoAplicado, setGastoAplicado] = useState('');

  const { data, isFetching } = useQuery({
    queryKey: ['unit-economics', desde, hasta, gastoAplicado],
    queryFn: () => api.get(`/api/erp/unit-economics?desde=${desde}&hasta=${hasta}` + (gastoAplicado !== '' ? `&gasto_adquisicion=${gastoAplicado}` : '')),
  });

  const m = data?.metricas;
  const status = data?.status;
  const ratio = m?.ratio_ltv_cac;
  const organico = data?.adquisicion_organica;
  const color = COLOR[status] || 'gray';
  const pct = organico ? 100 : (ratio == null ? 0 : Math.min(100, (ratio / 6) * 100));  // tope visual 6x
  const ratioTexto = organico ? '∞' : (ratio == null ? '—' : ratio.toFixed(1) + '×');

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Title order={4}>Salud del negocio · CAC / LTV</Title>
        <Group gap="xs" align="flex-end">
          <TextInput type="date" label="Desde" value={desde} onChange={e => setDesde(e.target.value)} />
          <TextInput type="date" label="Hasta" value={hasta} onChange={e => setHasta(e.target.value)} />
          <NumberInput label="Gasto de adquisición del período" description="Publicidad + ventas + comisiones. Déjalo en 0 si no inviertes en captación."
            w={230} min={0} thousandSeparator="," prefix="$ " value={gasto} onChange={setGasto} />
          <Button variant="default" loading={isFetching} onClick={() => setGastoAplicado(gasto === '' ? '' : Number(gasto))}>Calcular</Button>
        </Group>
      </Group>

      {!data ? <Skeleton height={220} radius="md" /> : status === 'sin_datos' ? (
        <Card withBorder radius="md" p="lg" className="card">
          <Text fw={600} mb="xs">Aún no puedo calcular la salud del negocio</Text>
          <Stack gap={4}>{(data.notas || []).map((n, i) => <Text key={i} size="sm" c="dimmed">· {n}</Text>)}</Stack>
        </Card>
      ) : (
        <>
          <Group align="stretch" gap="md" wrap="wrap">
            {/* Semáforo del ratio */}
            <Card withBorder radius="md" p="lg" className="card">
              <Group align="center" gap="lg">
                <RingProgress size={150} thickness={14} roundCaps sections={[{ value: pct, color }]}
                  label={<Stack gap={0} align="center"><Text fw={800} size="xl">{ratioTexto}</Text><Text size="xs" c="dimmed">LTV / CAC</Text></Stack>} />
                <Stack gap={6}>
                  <Badge color={color} variant="light" size="lg">{data.status_label}</Badge>
                  <Text size="sm" c="dimmed">Objetivo: {(data.objetivo_ratio || 3).toFixed(1)}× o más</Text>
                  <Text size="xs" c="dimmed">&lt;3 quema dinero · 3–5 sano · &gt;5 listo para escalar</Text>
                </Stack>
              </Group>
            </Card>

            {/* Barras CAC vs LTV */}
            <Card withBorder radius="md" p="md" className="card" style={{ flex: 1, minWidth: 280 }}>
              <Text size="sm" fw={600} mb="xs">Costo de adquirir vs. valor del cliente</Text>
              <Suspense fallback={<Skeleton height={150} radius="md" />}>
                <BarrasH altura={150} fmtMoneda={money} datos={[
                  { name: 'CAC (costo)', value: m.cac || 0, color: 'var(--red)' },
                  { name: 'LTV (ganancia)', value: m.ltv || 0, color: 'var(--green)' },
                ]} />
              </Suspense>
            </Card>
          </Group>

          {/* Insumos / desglose */}
          <Card withBorder radius="md" p="md" className="card">
            <Text size="sm" fw={600} mb="xs">Cómo se calculó ({data.dias} días{data.conta_activa ? '' : ' · contabilidad apagada: margen solo bruto'})</Text>
            <Table>
              <tbody>
                <tr><td>Clientes nuevos</td><td style={{ textAlign: 'right' }}>{data.insumos.clientes_nuevos}</td></tr>
                <tr><td>Gasto de adquisición</td><td style={{ textAlign: 'right' }}>{data.insumos.gasto_adquisicion == null ? '—' : money(data.insumos.gasto_adquisicion)}</td></tr>
                <tr><td><b>CAC</b> (gasto ÷ clientes nuevos)</td><td style={{ textAlign: 'right' }}><b>{m.cac == null ? '—' : money(m.cac)}</b></td></tr>
                <tr><td>Ticket promedio</td><td style={{ textAlign: 'right' }}>{money(m.ticket_promedio)}</td></tr>
                <tr><td>Frecuencia de compra (anual)</td><td style={{ textAlign: 'right' }}>{m.frecuencia_compra_anual}</td></tr>
                <tr><td>Margen neto</td><td style={{ textAlign: 'right' }}>{(m.margen_neto * 100).toFixed(1)}%</td></tr>
                <tr><td><b>LTV</b> (ticket × frecuencia × margen)</td><td style={{ textAlign: 'right' }}><b>{money(m.ltv)}</b></td></tr>
              </tbody>
            </Table>
            {(data.notas || []).map((n, i) => <Text key={i} size="xs" c="dimmed" mt={4}>· {n}</Text>)}
          </Card>
        </>
      )}
    </Stack>
  );
}
