import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, Text, Button } from '@mantine/core';
import { ReceiptText, Wallet, Landmark } from 'lucide-react';
import { api } from '../../api';
import { fmtMoneda, Kpi } from './comunes';

// Cajero: saludo (lo pone el padre) + SU caja del día + directo al mostrador.
// Centrado a media pantalla — su único trabajo es cobrar y cortar.
export default function VistaCajero() {
  const { data: corte } = useQuery({
    queryKey: ['mi-corte'],
    queryFn: () => api.get('/api/pos/corte').catch(() => null),
  });
  const yaCerro = (corte?.cortes || []).length > 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100dvh - 260px)' }}>
      <div className="cols-3" style={{ gap: 24, width: 'min(980px, 100%)' }}>
        <Card withBorder radius="md" p="xl" className="kpi-card kpi-sq kpi-dark" style={{ minHeight: 220 }}>
          <Kpi Icono={Wallet} color="rgba(255,255,255,0.95)" label="Mis ventas cobradas hoy">
            {fmtMoneda(corte?.total_sistema)}
          </Kpi>
        </Card>
        <Card withBorder radius="md" p="xl" className="kpi-card kpi-sq" style={{ minHeight: 220 }}>
          <Kpi Icono={Landmark} color={yaCerro ? 'var(--green)' : 'var(--yellow)'} label={yaCerro ? 'Corte de hoy cerrado' : 'Corte de hoy pendiente'}>
            {yaCerro ? fmtMoneda(corte?.cortes?.[0]?.total_sistema ?? corte?.total_sistema) : '—'}
          </Kpi>
        </Card>
        <Card withBorder radius="md" p="xl" className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12, minHeight: 220 }}>
          <Button size="lg" component={Link} to="/mostrador" leftSection={<ReceiptText size={18} strokeWidth={1.75} />}>
            Ir al mostrador
          </Button>
          <Text size="xs" c="dimmed" ta="center">
            {yaCerro ? 'Ya cerraste tu corte de hoy — mañana abres caja de nuevo' : 'Al terminar tu turno, cierra tu corte desde el mostrador'}
          </Text>
        </Card>
      </div>
    </div>
  );
}
