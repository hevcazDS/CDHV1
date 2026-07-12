// MiniCharts — gráficas chicas del ERP (SPEC_GRAFICAS_ERP §E). UN solo archivo
// = un solo chunk recharts, cargado SIEMPRE con lazy() donde se use (regla dura:
// ningún import de recharts fuera de un archivo lazy). Mismo estilo de tooltip/
// ejes que GraficaSemana. Colores solo por tokens semánticos.
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
  BarChart, Bar, XAxis, YAxis, AreaChart, Area, ReferenceLine, LabelList,
} from 'recharts';

const TT = {
  contentStyle: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, boxShadow: 'var(--shadow)' },
  labelStyle: { color: 'var(--text)', fontWeight: 600 },
};
const PALETA = ['var(--brand)', 'var(--info)', 'var(--green)', 'var(--yellow)', 'var(--text-mute)', 'var(--accent-2)'];

// ── Dona con total al centro (corte de caja por método) ──────────────────
export function Dona({ datos = [], centro, sub, fmtMoneda = (v) => v, altura = 160 }) {
  const total = datos.reduce((s, d) => s + (d.value || 0), 0);
  if (total <= 0) return null;
  return (
    <div style={{ position: 'relative', width: '100%', height: altura }}>
      <ResponsiveContainer width="100%" height={altura}>
        <PieChart>
          <Pie data={datos} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="var(--panel)" strokeWidth={2}>
            {datos.map((d, i) => <Cell key={i} fill={d.color || PALETA[i % PALETA.length]} />)}
          </Pie>
          <Tooltip {...TT} formatter={(v, n) => [fmtMoneda(v), n]} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
        <div>
          <div className="money" style={{ fontSize: 20, fontWeight: 800, lineHeight: 1 }}>{centro}</div>
          {sub && <div style={{ fontSize: 10.5, color: 'var(--text-mute)', marginTop: 2 }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Barras horizontales (rankings, top-N; margen negativo en rojo) ────────
export function BarrasH({ datos = [], dataKey = 'value', nameKey = 'name', fmtMoneda = (v) => v, altura, color = 'var(--brand)' }) {
  if (!datos.length) return null;
  const h = altura || Math.max(80, datos.length * 30 + 10);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={datos} layout="vertical" margin={{ left: 4, right: 40, top: 2, bottom: 2 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey={nameKey} width={128} tick={{ fontSize: 11, fill: 'var(--text-dim)' }} tickLine={false} axisLine={false} />
        <Tooltip {...TT} cursor={{ fill: 'var(--accent-soft)' }} formatter={(v) => [fmtMoneda(v), null]} />
        <Bar dataKey={dataKey} radius={[0, 6, 6, 0]} maxBarSize={22}>
          {datos.map((d, i) => <Cell key={i} fill={(d[dataKey] < 0) ? 'var(--red)' : (d.color || color)} />)}
          <LabelList dataKey={dataKey} position="right" formatter={fmtMoneda} style={{ fontSize: 10.5, fill: 'var(--text-mute)' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Sparkline desnudo (tendencia bajo un KPI) ────────────────────────────
export function Sparkline({ datos = [], dataKey = 'v', color = 'var(--brand)', altura = 36 }) {
  if (!datos.length || datos.every(d => !d[dataKey])) return null; // serie plana = ruido
  const id = 'sp' + Math.random().toString(36).slice(2, 7);
  return (
    <ResponsiveContainer width="100%" height={altura}>
      <AreaChart data={datos} margin={{ top: 3, bottom: 0, left: 0, right: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#${id})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Barra apilada 100% horizontal (aging, composición) ───────────────────
export function BarraApilada({ segmentos = [], fmtValor = (v) => v, altura = 40 }) {
  const total = segmentos.reduce((s, d) => s + (d.value || 0), 0);
  if (total <= 0) return null;
  const uno = [segmentos.reduce((o, s) => (o[s.name] = s.value, o), { _: 'x' })];
  return (
    <div>
      <ResponsiveContainer width="100%" height={altura}>
        <BarChart data={uno} layout="vertical" margin={{ top: 0, bottom: 0, left: 0, right: 0 }} stackOffset="expand">
          <XAxis type="number" hide domain={[0, 1]} />
          <YAxis type="category" dataKey="_" hide />
          <Tooltip {...TT} formatter={(v, n) => [`${fmtValor(v)} (${Math.round(v / total * 100)}%)`, n]} />
          {segmentos.map((s, i) => (
            <Bar key={s.name} dataKey={s.name} stackId="a" fill={s.color || PALETA[i % PALETA.length]} radius={i === 0 ? [6, 0, 0, 6] : i === segmentos.length - 1 ? [0, 6, 6, 0] : 0} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
        {segmentos.filter(s => s.value > 0).map((s, i) => (
          <span key={s.name} style={{ fontSize: 11, color: 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color || PALETA[i % PALETA.length] }} />
            {s.name}: <strong>{fmtValor(s.value)}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Cascada de P&L (barra flotante: cuánto se come cada renglón del total) ──
// items: [{ name, valor, tipo:'total'|'resta'|'resultado' }] en orden del P&L.
export function CascadaPyL({ items = [], fmtMoneda = (v) => v, altura = 170 }) {
  if (!items.length) return null;
  let acum = 0;
  const datos = items.map(it => {
    if (it.tipo === 'total' || it.tipo === 'resultado') {
      const base = it.tipo === 'total' ? 0 : 0; // totales arrancan del piso
      const fila = { name: it.name, base, span: Math.abs(it.valor), signo: it.valor >= 0, tipo: it.tipo, real: it.valor };
      acum = it.valor;
      return fila;
    }
    // resta: barra flotante desde acum hasta acum - |valor|
    const desde = acum;
    acum = acum - Math.abs(it.valor);
    return { name: it.name, base: acum, span: Math.abs(it.valor), signo: false, tipo: 'resta', real: -Math.abs(it.valor) };
  });
  const color = (d) => d.tipo === 'total' ? 'var(--brand)' : d.tipo === 'resta' ? 'var(--red)' : (d.signo ? 'var(--green)' : 'var(--red)');
  return (
    <ResponsiveContainer width="100%" height={altura}>
      <BarChart data={datos} layout="vertical" margin={{ left: 4, right: 46, top: 2, bottom: 2 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={132} tick={{ fontSize: 11, fill: 'var(--text-dim)' }} tickLine={false} axisLine={false} />
        <Tooltip {...TT} formatter={(v, n, p) => [fmtMoneda(p?.payload?.real ?? v), null]} />
        <Bar dataKey="base" stackId="a" fill="transparent" />
        <Bar dataKey="span" stackId="a" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {datos.map((d, i) => <Cell key={i} fill={color(d)} />)}
          <LabelList dataKey="real" position="right" formatter={fmtMoneda} style={{ fontSize: 10, fill: 'var(--text-mute)' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Comparativo período: 2 métricas × (actual vs anterior) ───────────────
export function Comparativo({ datos = [], fmtMoneda = (v) => v, altura = 150 }) {
  if (!datos.length) return null;
  return (
    <ResponsiveContainer width="100%" height={altura}>
      <BarChart data={datos} margin={{ left: 4, right: 8, top: 8, bottom: 2 }} barCategoryGap="30%">
        <XAxis dataKey="name" stroke="var(--text-mute)" fontSize={11} tickLine={false} axisLine={false} />
        <YAxis hide />
        <Tooltip {...TT} formatter={(v, n) => [fmtMoneda(v), n === 'ant' ? 'Anterior' : 'Actual']} />
        <Bar dataKey="ant" fill="var(--panel-2)" radius={[6, 6, 0, 0]} maxBarSize={38} name="ant" />
        <Bar dataKey="act" fill="var(--brand)" radius={[6, 6, 0, 0]} maxBarSize={38} name="act">
          <LabelList dataKey="delta" position="top" style={{ fontSize: 10.5, fill: 'var(--text-mute)' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Área de proyección (4 puntos; tramo bajo cero en rojo + línea de cero) ─
export function AreaProyeccion({ datos = [], fmtMoneda = (v) => v, altura = 160 }) {
  if (!datos.length) return null;
  const hayNegativo = datos.some(d => d.v < 0);
  return (
    <ResponsiveContainer width="100%" height={altura}>
      <AreaChart data={datos} margin={{ top: 8, bottom: 4, left: 4, right: 8 }}>
        <defs>
          <linearGradient id="proy" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="label" stroke="var(--text-mute)" fontSize={11} tickLine={false} axisLine={false} />
        <YAxis stroke="var(--text-mute)" fontSize={11} tickLine={false} axisLine={false} width={46} tickFormatter={(v) => fmtMoneda(v)} />
        <Tooltip {...TT} formatter={(v) => [fmtMoneda(v), 'Saldo proyectado']} />
        {hayNegativo && <ReferenceLine y={0} stroke="var(--red)" strokeDasharray="4 4" />}
        <Area type="monotone" dataKey="v" stroke="var(--brand)" strokeWidth={2.5} fill="url(#proy)" dot={{ r: 3, fill: 'var(--brand)', strokeWidth: 0 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
