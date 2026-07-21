import { useState } from 'react';
import {
  Stack, Select, Radio, Group, Button, Text, Alert, Paper, Title,
} from '@mantine/core';
import { api } from '../../api';

const GIROS = [
  { value: 'jugueteria',  label: 'Juguetería' },
  { value: 'restaurante', label: 'Restaurante' },
  { value: 'abarrotes',   label: 'Abarrotes' },
  { value: 'ferreteria',  label: 'Ferretería' },
  { value: 'servicios',   label: 'Servicios' },
  { value: 'retail',      label: 'Retail / ropa' },
];

export default function DemoTab() {
  const [giro,    setGiro]    = useState('jugueteria');
  const [periodo, setPeriodo] = useState('1m');
  const [volumen, setVolumen] = useState('medio');
  const [loading, setLoading] = useState(false);
  const [limpiando, setLimpiando] = useState(false);
  const [resultado, setResultado] = useState(null); // { ok, ...data } | { ok:false, error }

  const generar = async () => {
    setLoading(true);
    setResultado(null);
    try {
      const d = await api.post('/api/prime/demo/generar', { giro, periodo, volumen });
      setResultado({ ok: true, ...d });
    } catch (e) {
      setResultado({ ok: false, error: e.message });
    } finally {
      setLoading(false);
    }
  };

  const limpiar = async () => {
    if (!window.confirm('¿Borrar TODOS los datos demo (clientes con tag _demo_ y pedidos con canal_creacion=demo)? Esto no se puede deshacer.')) return;
    setLimpiando(true);
    setResultado(null);
    try {
      const d = await api.del('/api/prime/demo/limpiar');
      setResultado({ ok: true, limpiar: true, ...d });
    } catch (e) {
      setResultado({ ok: false, error: e.message });
    } finally {
      setLimpiando(false);
    }
  };

  return (
    <Stack gap="md" maw={600}>
      <div>
        <Title order={4} mb={4}>Generador de datos demo</Title>
        <Text size="sm" c="dimmed">
          Genera clientes ficticios, pedidos y asientos contables para mostrar el sistema
          a un cliente o probar reportes. Los datos se marcan como demo y se pueden borrar
          con un clic sin afectar el catálogo, la configuración ni los datos reales.
        </Text>
      </div>

      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Select
            label="Giro del negocio"
            data={GIROS}
            value={giro}
            onChange={v => v && setGiro(v)}
            allowDeselect={false}
          />

          <Radio.Group label="Período retroactivo" value={periodo} onChange={setPeriodo}>
            <Group mt={6} gap="sm">
              <Radio value="1d"  label="1 día" />
              <Radio value="1w"  label="1 semana" />
              <Radio value="1m"  label="1 mes" />
              <Radio value="6m"  label="6 meses" />
              <Radio value="1y"  label="1 año" />
            </Group>
          </Radio.Group>

          <Radio.Group label="Volumen" value={volumen} onChange={setVolumen}>
            <Group mt={6} gap="sm">
              <Radio value="bajo"  label="Bajo (~2/día)" />
              <Radio value="medio" label="Medio (~10/día)" />
              <Radio value="alto"  label="Alto (~30/día)" />
            </Group>
          </Radio.Group>

          <Button onClick={generar} loading={loading} mt="xs">
            Generar datos demo
          </Button>
        </Stack>
      </Paper>

      {resultado && !resultado.limpiar && (
        <Alert color={resultado.ok ? 'green' : 'red'} variant="light">
          {resultado.ok
            ? `Generado: ${resultado.clientes} clientes · ${resultado.pedidos} pedidos · $${resultado.total_ventas?.toLocaleString('es-MX', { minimumFractionDigits: 2 })} en ventas · ${resultado.periodo_generado}`
            : `Error: ${resultado.error}`}
        </Alert>
      )}

      <Paper withBorder p="md" radius="md" style={{ borderColor: 'var(--mantine-color-red-4)' }}>
        <Stack gap="xs">
          <Text size="sm" fw={600} c="red">Limpiar datos demo</Text>
          <Text size="xs" c="dimmed">
            Borra únicamente clientes marcados con <code>_demo_</code> y pedidos con
            canal <code>demo</code>, incluyendo sus detalles, links de pago y asientos contables.
            No toca el catálogo ni la configuración.
          </Text>
          <Button color="red" variant="outline" onClick={limpiar} loading={limpiando}>
            Limpiar datos demo
          </Button>
        </Stack>
      </Paper>

      {resultado?.limpiar && (
        <Alert color={resultado.ok ? 'green' : 'red'} variant="light">
          {resultado.ok
            ? `Limpieza completada: ${resultado.clientes_borrados} clientes y ${resultado.pedidos_borrados} pedidos borrados.`
            : `Error: ${resultado.error}`}
        </Alert>
      )}
    </Stack>
  );
}
