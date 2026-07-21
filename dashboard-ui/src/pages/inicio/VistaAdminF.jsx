import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import PuntosGrafica from '../../components/PuntosGrafica';
import { fdate } from '../../lib/format';
import { fmtMoneda, diasSemana } from './comunes';

const GraficaSemana = lazy(() => import('../../components/GraficaSemana'));
const Sparkline = lazy(() => import('../../components/MiniCharts').then(m => ({ default: m.Sparkline })));
const MODOS = [
  { value: 'area', label: 'Área' },
  { value: 'barras', label: 'Barras' },
];

// Inicio del tema F — propuesta P3 aprobada (REDISENO_UI_F.md): UN bloque héroe
// de sumi SUAVE (no negro: "rompe la esencia" — feedback del dueño) con lo de
// hoy, el resto de KPIs como renglones hairline, gráfica de área de tinta con
// HOY en bermellón, y "Requiere tu mano" con entrada escalonada (f-stagger).
export default function VistaAdminF() {
  const [modo, setModo] = useState(() => (localStorage.getItem('jc-grafica-f') === 'barras' ? 'barras' : 'area'));
  const cambiarModo = (m) => { setModo(m); localStorage.setItem('jc-grafica-f', m); };

  const { data: pedidos, error } = useQuery({ queryKey: ['pedidos'], queryFn: () => api.get('/api/pedidos') });
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: () => api.get('/api/stats') });
  const { data: met } = useQuery({ queryKey: ['metricas'], queryFn: () => api.get('/api/metricas') });
  const { data: cxp = [] } = useQuery({ queryKey: ['erp-cxp'], queryFn: () => api.get('/api/erp/cxp').catch(() => []) });
  const { data: solicitudes = [] } = useQuery({ queryKey: ['compras-sol'], queryFn: () => api.get('/api/compras/solicitudes').catch(() => []) });
  const { data: fiados } = useQuery({ queryKey: ['pos-fiados'], queryFn: () => api.get('/api/pos/fiados').catch(() => ({ fiados: [] })) });

  const ventasHoy = stats?.ventas_hoy || 0;
  const pedidosHoy = met?.pedidos?.hoy?.n ?? stats?.pedidos_hoy ?? 0;
  const colaAtencion = stats?.cola_atencion || 0;
  const pagosPendientes = stats?.pagos_pendientes || 0;
  const clientes = stats?.clientes_total || 0;
  const mkt = stats?.marketing;
  const cxpVencidas = cxp.filter(c => c.estatus !== 'pagada' && c.dias_para_vencer != null && c.dias_para_vencer < 0).length;
  const solPendientes = solicitudes.filter(s => s.estatus === 'pendiente').length;
  // Fiados VENCIDOS (cobranza al cliente): cuentas por cobrar, no por pagar.
  const fiadosVenc = (fiados?.fiados || []).filter(f => f.dias_vencido_max != null && f.dias_vencido_max > 0);
  const fiadosVencMonto = fiadosVenc.reduce((s, f) => s + (f.adeudo || 0), 0);

  const dias = diasSemana(met?.por_dia);
  const totalSemana = dias.reduce((s, d) => s + d.n, 0);
  const montoSemana = dias.reduce((s, d) => s + d.t, 0);
  const ultimos = (pedidos || []).slice(0, 5);

  const deltaAyer = (hoy, ayer) => {
    if (ayer == null || (!ayer && !hoy)) return null;
    const pct = ayer > 0 ? Math.round((hoy - ayer) / ayer * 100) : 100;
    return { pct: Math.abs(pct), sube: pct >= 0 };
  };
  const dV = deltaAyer(ventasHoy, stats?.ventas_ayer);

  // Pendientes accionables ("Requiere tu mano") — solo los que existen.
  const mano = [
    colaAtencion > 0 && { k: 'cola', txt: `${colaAtencion} cliente${colaAtencion > 1 ? 's' : ''} esperando atención`, go: 'responder', to: '/cola', urg: true },
    (mkt?.abandonados_n || 0) > 0 && { k: 'carr', txt: `${mkt.abandonados_n} carritos abandonados`, det: fmtMoneda(mkt.abandonados_monto || 0), go: 'recuperar', to: '/notificaciones' },
    fiadosVenc.length > 0 && { k: 'fiado', txt: `${fiadosVenc.length} fiado${fiadosVenc.length > 1 ? 's' : ''} vencido${fiadosVenc.length > 1 ? 's' : ''} por cobrar`, det: fmtMoneda(fiadosVencMonto), go: 'cobrar', to: '/fiados', urg: true },
    cxpVencidas > 0 && { k: 'cxp', txt: `${cxpVencidas} factura${cxpVencidas > 1 ? 's' : ''} por pagar vencida${cxpVencidas > 1 ? 's' : ''}`, go: 'revisar', to: '/erp?tab=gastos' },
    solPendientes > 0 && { k: 'sol', txt: `${solPendientes} solicitud${solPendientes > 1 ? 'es' : ''} de compra`, go: 'aprobar', to: '/compras' },
  ].filter(Boolean);

  return (
    <div className="pagina-llena" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {error && <div className="login-error mb-5">No se pudieron cargar los pedidos: {error.message}</div>}

      {/* héroe sumi suave + renglones */}
      <div className="f-top">
        <div className="f-hero">
          <small>ventas hoy</small>
          <div className="v">{fmtMoneda(ventasHoy)}</div>
          <div className="d">{dV ? `${dV.sube ? '▲' : '▼'} ${dV.pct}% vs ayer · ` : ''}{pedidosHoy} pedido{pedidosHoy === 1 ? '' : 's'}</div>
          <div className="sp"><Suspense fallback={null}><Sparkline datos={dias.map(d => ({ v: d.t }))} color="rgba(242,239,232,0.5)" /></Suspense></div>
        </div>
        <div className="f-resto">
          <Link className="f-k" to="/pedidos">
            <small>por cobrar</small><span className="v ocre">{pagosPendientes}</span><span className="d">pagos pendientes</span>
          </Link>
          <Link className="f-k" to="/cola">
            <small>esperando atención</small><span className={`v${colaAtencion > 0 ? ' beru' : ''}`}>{colaAtencion}</span>
            {colaAtencion > 0 && <span className="d urg">responder →</span>}
          </Link>
          <Link className="f-k" to="/clientes">
            <small>clientes activos</small><span className="v">{clientes}</span><span className="d">últimos 30 días</span>
          </Link>
          <div className="f-k">
            <small>chats hoy</small><span className="v">{stats?.chats_hoy ?? 0}</span>
            {mkt && <span className="d">{mkt.recuperados_30d} carritos recuperados · 30d</span>}
          </div>
        </div>
      </div>

      <div className="fila-2col" style={{ flex: 1, minHeight: 0 }}>
        <div className="f-seccion">
          <div className="f-h4">
            <span>Ventas · últimos 7 días</span>
            <span className="der">total <b>{fmtMoneda(montoSemana)}</b> · {totalSemana} pedidos
              <PuntosGrafica opciones={MODOS} valor={modo} onChange={cambiarModo} /></span>
          </div>
          <div className="chart-wrap">
            <Suspense fallback={null}>
              <GraficaSemana dias={dias} fmtMoneda={fmtMoneda} altura="100%" modo={modo} />
            </Suspense>
          </div>
        </div>

        <div className="f-seccion">
          <div className="f-h4"><span>Requiere tu mano</span></div>
          <div className="f-stagger">
            {mano.length === 0 && <div className="f-row" style={{ color: 'var(--text-mute)' }}>Nada pendiente — todo fluye solo ✓</div>}
            {mano.map(m => (
              <Link key={m.k} to={m.to} className="f-row">
                <span className="who">{m.txt}{m.det && <span className="t"> · {m.det}</span>}</span>
                <span className={`go${m.urg ? ' urg' : ''}`}>{m.go}</span>
              </Link>
            ))}
          </div>

          <div className="f-h4" style={{ marginTop: 22 }}>
            <span>Últimos pedidos</span>
            <Link to="/pedidos" className="der lnk">ver todos →</Link>
          </div>
          <div className="f-stagger">
            {ultimos.map(p => (
              <div key={p.id_pedido} className="f-row" title={p.cliente || ''}>
                <span className="who">{p.cliente || '—'}<span className="t mono"> {p.folio}</span></span>
                <span className={`st st-${p.estatus}`}>{p.estatus}</span>
                <span className="t">{fdate(p.creado_en)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
