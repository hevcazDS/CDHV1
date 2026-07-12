import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Group, Text } from '@mantine/core';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';
import { toastOk, prompt } from '../lib/ui';
import { useAuth } from '../context/AuthContext';
import { tieneRango } from '../lib/roles';
import { useTextoEmoji } from '../context/EmojiContext';
import { money } from '../lib/format';

// Cartera de fiado (cuentas por cobrar del mostrador): quién debe, cuánto,
// desde cuándo y qué tan vencido. Cobranza se hace en Pedidos (marcar pagado).

export default function Fiados() {
  const txt = useTextoEmoji();
  const qc = useQueryClient();
  const { user } = useAuth();
  const esGerente = tieneRango(user?.rol, 'gerente');
  const { data } = useQuery({ queryKey: ['fiados'], queryFn: () => api.get('/api/pos/fiados'), refetchInterval: 60000 });
  const fiados = data?.fiados || [];

  const constancia = (f) => {
    const hoy = new Date().toLocaleDateString('es-MX');
    const w = window.open('', '_blank', 'width=720,height=800');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Constancia de adeudo — ${f.nombre || ''}</title>
      <style>body{font-family:system-ui,Arial,sans-serif;max-width:640px;margin:32px auto;color:#111;line-height:1.5}
      h1{font-size:18px;border-bottom:2px solid #111;padding-bottom:8px} .row{display:flex;justify-content:space-between;margin:6px 0}
      .tot{font-size:20px;font-weight:700} .firma{margin-top:64px;border-top:1px solid #111;width:260px;padding-top:6px;font-size:12px}
      .nota{font-size:11px;color:#555;margin-top:24px}</style></head><body>
      <h1>Constancia de adeudo (crédito)</h1>
      <p>${hoy}</p>
      <div class="row"><span>Cliente:</span><strong>${f.nombre || '—'}</strong></div>
      <div class="row"><span>Teléfono:</span><span>${f.telefono || '—'}</span></div>
      <div class="row"><span>Pedidos a crédito:</span><span>${f.pedidos}</span></div>
      <div class="row"><span>Próximo vencimiento:</span><span>${f.proximo_vence || '—'}</span></div>
      <div class="row tot"><span>Adeudo total:</span><span>${money(f.adeudo)}</span></div>
      <p class="nota">El cliente reconoce el adeudo por la mercancía entregada a crédito y se compromete a liquidarlo en el plazo acordado. Este documento es un comprobante interno de la operación, no un CFDI.</p>
      <div class="firma">Firma del cliente</div>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  const fijarLimite = async (f) => {
    const v = await prompt({ titulo: 'Límite de crédito', mensaje: `Tope de fiado para ${f.nombre} (0 = sin límite):`, valorInicial: String(f.limite_credito || 0), tipo: 'text' });
    if (v === null) return;
    const r = await api.put(`/api/pos/cliente/${f.id_cliente}/limite`, { limite_credito: Number(v) }).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) return handleApiError(new Error(r.error));
    toastOk('Límite actualizado'); qc.invalidateQueries({ queryKey: ['fiados'] });
  };

  return (
    <div>
      <div className="page-title">Fiados (cuentas por cobrar)</div>
      <div className="page-sub">Cartera de crédito del mostrador. Para cobrar, marca el pago en Pedidos.</div>

      <Group mb="md">
        <Card withBorder radius="md" p="md" className="kpi-card kpi-dark">
          <Text size="xs" c="rgba(255,255,255,0.8)">Total por cobrar</Text>
          <Text fw={700} size="xl">{money(data?.total_por_cobrar)}</Text>
        </Card>
        <Card withBorder radius="md" p="md" className="kpi-card">
          <Text size="xs" c="dimmed">Clientes con fiado</Text>
          <Text fw={700} size="xl">{fiados.length}</Text>
        </Card>
      </Group>

      <Card withBorder radius="md" p="lg" className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Cliente</th><th>Teléfono</th><th>Pedidos</th><th>Adeudo</th><th>Límite</th><th>Vence</th><th>Estado</th>{esGerente && <th></th>}</tr></thead>
            <tbody>
              {fiados.length === 0 && <tr><td colSpan={esGerente ? 8 : 7} className="empty">{txt('Sin fiados pendientes 🎉')}</td></tr>}
              {fiados.map(f => {
                const vencido = f.dias_vencido_max != null && f.dias_vencido_max > 0;
                return (
                  <tr key={f.id_cliente || f.nombre}>
                    <td><strong>{f.nombre || '—'}</strong></td>
                    <td className="text-muted" style={{ fontSize: 12 }}>{f.telefono || '—'}</td>
                    <td>{f.pedidos}</td>
                    <td style={{ fontWeight: 700 }}>{money(f.adeudo)}</td>
                    <td className="text-muted">{f.limite_credito > 0 ? money(f.limite_credito) : '—'}</td>
                    <td className="text-muted" style={{ fontSize: 12 }}>{f.proximo_vence || '—'}</td>
                    <td>
                      {vencido
                        ? <span className="chip" style={{ background: 'var(--red)', color: '#fff' }}>vencido {f.dias_vencido_max}d</span>
                        : <span className="chip">al corriente</span>}
                    </td>
                    {esGerente && <td><Group gap={4} wrap="nowrap">
                      <button className="btn btn-sm" onClick={() => constancia(f)}>Constancia</button>
                      <button className="btn btn-sm" onClick={() => fijarLimite(f)} disabled={!f.id_cliente}>Límite</button>
                    </Group></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
