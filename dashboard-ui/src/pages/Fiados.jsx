import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Group, Text } from '@mantine/core';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';
import { toastOk, prompt } from '../lib/ui';
import { useAuth } from '../context/AuthContext';
import { tieneRango } from '../lib/roles';
import { permite } from '../lib/permisos';
import { useTextoEmoji } from '../context/EmojiContext';
import { money } from '../lib/format';

// Cartera de fiado (cuentas por cobrar del mostrador): quién debe, cuánto,
// desde cuándo y qué tan vencido. Cobranza se hace en Pedidos (marcar pagado).

export default function Fiados() {
  const txt = useTextoEmoji();
  const qc = useQueryClient();
  const { user } = useAuth();
  const esGerente = tieneRango(user?.rol, 'gerente');
  const puedeCobrar = permite(user?.rol, 'pos'); // cajero/operador cobran la deuda aquí
  const mostrarAcciones = esGerente || puedeCobrar;
  const { data } = useQuery({ queryKey: ['fiados'], queryFn: () => api.get('/api/pos/fiados'), refetchInterval: 60000 });
  const fiados = data?.fiados || [];

  // Escapa HTML: el nombre/teléfono los teclea el CLIENTE por WhatsApp
  // (ASK_NOMBRE) y aquí se interpolan en un document.write con <script> —
  // sin escapar es XSS almacenado en la sesión del operador (REVISION_SEGURIDAD M1).
  const esc = (s) => String(s ?? '—').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const constancia = (f) => {
    const hoy = new Date().toLocaleDateString('es-MX');
    const w = window.open('', '_blank', 'width=720,height=800');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Constancia de adeudo — ${esc(f.nombre)}</title>
      <style>body{font-family:system-ui,Arial,sans-serif;max-width:640px;margin:32px auto;color:#111;line-height:1.5}
      h1{font-size:18px;border-bottom:2px solid #111;padding-bottom:8px} .row{display:flex;justify-content:space-between;margin:6px 0}
      .tot{font-size:20px;font-weight:700} .firma{margin-top:64px;border-top:1px solid #111;width:260px;padding-top:6px;font-size:12px}
      .nota{font-size:11px;color:#555;margin-top:24px}</style></head><body>
      <h1>Constancia de adeudo (crédito)</h1>
      <p>${esc(hoy)}</p>
      <div class="row"><span>Cliente:</span><strong>${esc(f.nombre)}</strong></div>
      <div class="row"><span>Teléfono:</span><span>${esc(f.telefono)}</span></div>
      <div class="row"><span>Pedidos a crédito:</span><span>${esc(f.pedidos)}</span></div>
      <div class="row"><span>Próximo vencimiento:</span><span>${esc(f.proximo_vence)}</span></div>
      <div class="row tot"><span>Adeudo total:</span><span>${esc(money(f.adeudo))}</span></div>
      <p class="nota">El cliente reconoce el adeudo por la mercancía entregada a crédito y se compromete a liquidarlo en el plazo acordado. Este documento es un comprobante interno de la operación, no un CFDI.</p>
      <div class="firma">Firma del cliente</div>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  // Cobrar (abono): liquida tickets completos viejo→nuevo hasta donde alcance el
  // monto. Vacío/igual al adeudo = liquida todo. El cajero ya no depende de Pedidos.
  const cobrar = async (f) => {
    const v = await prompt({ titulo: `Cobrar a ${f.nombre || 'cliente'}`, mensaje: `Adeudo: ${money(f.adeudo)}. Monto del abono (deja el total para liquidar todo):`, valorInicial: String(f.adeudo || ''), tipo: 'text' });
    if (v === null) return;
    const monto = Number(String(v).replace(/[^0-9.]/g, ''));
    if (!(monto > 0)) return handleApiError(new Error('Captura un monto válido'));
    const metodo = await prompt({ titulo: 'Método de pago', mensaje: '¿Cómo pagó?', valorInicial: 'efectivo',
      opciones: [{ value: 'efectivo', label: 'Efectivo' }, { value: 'tarjeta', label: 'Tarjeta' }, { value: 'transferencia', label: 'Transferencia' }] });
    if (!metodo) return;
    const r = await api.post(`/api/pos/fiados/${f.id_cliente}/abono`, { monto, metodo_pago: metodo }).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) return handleApiError(new Error(r.error));
    toastOk(`Cobrado ${money(r.aplicado)} · ${r.tickets_pagados} ticket(s)` + (r.saldo_nuevo > 0 ? ` · saldo ${money(r.saldo_nuevo)}` : ' · al corriente 🎉'));
    qc.invalidateQueries({ queryKey: ['fiados'] });
  };

  const fijarLimite = async (f) => {
    const v = await prompt({ titulo: 'Límite de crédito', mensaje: `Tope de fiado para ${f.nombre} (0 = sin límite):`, valorInicial: String(f.limite_credito || 0), tipo: 'text' });
    if (v === null) return;
    const r = await api.put(`/api/pos/cliente/${f.id_cliente}/limite`, { limite_credito: Number(v) }).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) return handleApiError(new Error(r.error));
    toastOk('Límite actualizado'); qc.invalidateQueries({ queryKey: ['fiados'] });
  };

  return (
    <div className="sin-scroll">
      <div className="page-title">Fiados (cuentas por cobrar)</div>
      <div className="page-sub">Cartera de crédito del mostrador. Cobra el abono aquí mismo con el botón <strong>Cobrar</strong>.</div>

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

      <Card withBorder radius="md" p="lg" className="card sin-scroll-card">
        <div className="table-wrap page-scrollable">
          <table>
            <thead><tr><th>Cliente</th><th>Teléfono</th><th>Pedidos</th><th>Adeudo</th><th>Límite</th><th>Vence</th><th>Estado</th>{mostrarAcciones && <th></th>}</tr></thead>
            <tbody>
              {fiados.length === 0 && <tr><td colSpan={mostrarAcciones ? 8 : 7} className="empty">{txt('Sin fiados pendientes 🎉')}</td></tr>}
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
                    {mostrarAcciones && <td><Group gap={4} wrap="nowrap">
                      {puedeCobrar && <button className="btn btn-sm btn-primary" onClick={() => cobrar(f)} disabled={!f.id_cliente}>Cobrar</button>}
                      <button className="btn btn-sm" onClick={() => constancia(f)}>Constancia</button>
                      {esGerente && <button className="btn btn-sm" onClick={() => fijarLimite(f)} disabled={!f.id_cliente}>Límite</button>}
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
