import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, Text, Button } from '@mantine/core';
import { ReceiptText, Wallet } from 'lucide-react';
import { api } from '../../api';
import { fmtMoneda, Kpi } from './comunes';

// Cajero: saludo (lo pone el padre) + SU caja del día + directo al mostrador.
export default function VistaCajero() {
  const { data: corte } = useQuery({
    queryKey: ['mi-corte'],
    queryFn: () => api.get('/api/pos/corte').catch(() => null),
  });
  const yaCerro = (corte?.cortes || []).length > 0;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 720 }}>
      <Card withBorder radius="md" p="xl" className="kpi-card kpi-sq kpi-dark">
        <Kpi Icono={Wallet} color="rgba(255,255,255,0.95)" label="Mis ventas cobradas hoy">
          {fmtMoneda(corte?.total_sistema)}
        </Kpi>
      </Card>
      <Card withBorder radius="md" p="xl" className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
        <Button size="lg" component={Link} to="/mostrador" leftSection={<ReceiptText size={18} strokeWidth={1.75} />}>
          Ir al mostrador
        </Button>
        <Text size="xs" c="dimmed" ta="center">
          {yaCerro ? '✓ Ya cerraste tu corte de hoy' : 'Al terminar tu turno, cierra tu corte desde el mostrador'}
        </Text>
      </Card>
    </div>
  );
}
