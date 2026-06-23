import { useQuery } from '@tanstack/react-query';
import { Card, Text } from '@mantine/core';
import { api } from '../api';
import { useWhatsAppQR } from '../hooks/useWhatsAppQR';
import WhatsAppQR from '../components/WhatsAppQR';
import { useTextoEmoji } from '../context/EmojiContext';

export default function Inicio() {
  const txt = useTextoEmoji();
  // Caso normal: ya hubo login al dashboard y WhatsApp se desvincula después
  // (ej. el teléfono "olvida" el dispositivo) — App.jsx solo cubre el primer
  // arranque, antes de loguearse; este aviso cubre el resto del tiempo.
  const { qr } = useWhatsAppQR();

  const { data: pedidos, error } = useQuery({
    queryKey: ['pedidos'],
    queryFn: () => api.get('/api/pedidos'),
  });
  // emails_error no tenía ningún lugar en el dashboard donde verse — antes
  // un correo de confirmación fallido solo era visible consultando SQL
  // directo (ver dashboard/server.js).
  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get('/api/stats'),
  });

  const total = pedidos?.length || 0;
  const pendientes = pedidos?.filter(p => p.estatus !== 'entregado' && p.estatus !== 'cancelado').length || 0;
  const emailsError = stats?.emails_error || 0;
  const ventasHoy = stats?.ventas_hoy || 0;
  const pedidosHoy = stats?.pedidos_hoy || 0;
  const pagadosHoy = stats?.pedidos_pagados_hoy || 0;
  const colaAtencion = stats?.cola_atencion || 0;
  const pagosPendientes = stats?.pagos_pendientes || 0;
  const clientes = stats?.clientes_total || 0;

  const fmtMoneda = (n) => '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div>
      <div className="page-title">Inicio</div>
      <div className="page-sub">Resumen general de la operación</div>
      {error && <div className="login-error" style={{ marginBottom: 20 }}>No se pudieron cargar los pedidos: {error.message}</div>}
      <WhatsAppQR qr={qr} />

      {/* Operación de hoy — lo primero que un dueño quiere ver al abrir el panel */}
      <Text size="sm" c="dimmed" fw={600} mb={8} style={{ textTransform: 'uppercase', letterSpacing: '.04em' }}>Hoy</Text>
      <div className="kpi-grid">
        <Card withBorder radius="md" p="lg" className="kpi-card" style={{ borderColor: 'var(--accent, #2f9e44)' }}>
          <Text size="sm" c="dimmed">{txt('💵 Ventas cobradas hoy')}</Text>
          <Text size="26px" fw={700}>{fmtMoneda(ventasHoy)}</Text>
          <Text size="xs" c="dimmed" mt={4}>{pagadosHoy} pago{pagadosHoy === 1 ? '' : 's'} confirmado{pagadosHoy === 1 ? '' : 's'}</Text>
        </Card>
        <Card withBorder radius="md" p="lg" className="kpi-card">
          <Text size="sm" c="dimmed">{txt('🧾 Pedidos de hoy')}</Text>
          <Text size="26px" fw={700}>{pedidosHoy}</Text>
        </Card>
        {colaAtencion > 0 && (
          <Card withBorder radius="md" p="lg" className="kpi-card" style={{ borderColor: 'var(--red)' }}>
            <Text size="sm" c="dimmed">{txt('👤 Clientes esperando atención')}</Text>
            <Text size="26px" fw={700}>{colaAtencion}</Text>
          </Card>
        )}
      </div>

      {/* Acumulado / pendientes */}
      <Text size="sm" c="dimmed" fw={600} mt="lg" mb={8} style={{ textTransform: 'uppercase', letterSpacing: '.04em' }}>General</Text>
      <div className="kpi-grid">
        <Card withBorder radius="md" p="lg" className="kpi-card">
          <Text size="sm" c="dimmed">Pedidos (últimos 100)</Text>
          <Text size="26px" fw={700}>{total}</Text>
        </Card>
        <Card withBorder radius="md" p="lg" className="kpi-card">
          <Text size="sm" c="dimmed">Pendientes</Text>
          <Text size="26px" fw={700}>{pendientes}</Text>
        </Card>
        <Card withBorder radius="md" p="lg" className="kpi-card">
          <Text size="sm" c="dimmed">{txt('💳 Pagos por cobrar')}</Text>
          <Text size="26px" fw={700}>{pagosPendientes}</Text>
        </Card>
        <Card withBorder radius="md" p="lg" className="kpi-card">
          <Text size="sm" c="dimmed">{txt('🧑 Clientes activos')}</Text>
          <Text size="26px" fw={700}>{clientes}</Text>
        </Card>
        {emailsError > 0 && (
          <Card withBorder radius="md" p="lg" className="kpi-card" style={{ borderColor: 'var(--red)' }}>
            <Text size="sm" c="dimmed">{txt('⚠️ Emails con error')}</Text>
            <Text size="26px" fw={700}>{emailsError}</Text>
          </Card>
        )}
      </div>
    </div>
  );
}
