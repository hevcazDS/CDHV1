import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Cell, CartesianGrid } from 'recharts';

// modo: 'barras' | 'linea' | 'pct' (% del total de la semana por día)
export default function GraficaSemana({ dias, fmtMoneda, altura = 200, modo = 'barras' }) {
  const total = dias.reduce((s, d) => s + d.n, 0);
  const data = dias.map(d => ({ ...d, v: modo === 'pct' ? (total > 0 ? +((d.n / total) * 100).toFixed(1) : 0) : d.n }));
  const maxV = Math.max(1, ...data.map(d => d.v));

  const ejes = (
    <>
      <CartesianGrid stroke="var(--border)" vertical={false} />
      <XAxis dataKey="label" stroke="var(--text-mute)" fontSize={11} tickLine={false} axisLine={false} />
      <YAxis stroke="var(--text-mute)" fontSize={11} tickLine={false} axisLine={false} width={30}
        allowDecimals={modo === 'pct'} unit={modo === 'pct' ? '%' : ''} />
    </>
  );
  const tooltip = (
    <Tooltip
      cursor={{ fill: 'var(--accent-soft)' }}
      contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, boxShadow: 'var(--shadow)' }}
      labelStyle={{ color: 'var(--text)', fontWeight: 600 }}
      formatter={(v, name, item) => {
        const p = item?.payload || {};
        return modo === 'pct'
          ? [`${v}% de la semana · ${p.n} pedido${p.n === 1 ? '' : 's'}`, null]
          : [`${v} pedido${v === 1 ? '' : 's'} · ${fmtMoneda(p.t || 0)}`, null];
      }}
    />
  );

  return (
    <ResponsiveContainer width="100%" height={altura}>
      {modo === 'linea' ? (
        <LineChart data={data}>
          {ejes}{tooltip}
          <Line type="monotone" dataKey="v" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 4, fill: 'var(--accent)', strokeWidth: 0 }} />
        </LineChart>
      ) : (
        <BarChart data={data} barCategoryGap="28%">
          {ejes}{tooltip}
          <Bar dataKey="v" radius={[10, 10, 6, 6]}>
            {data.map(d => (
              <Cell key={d.dia} fill={d.v === maxV && d.v > 0 ? 'var(--accent)' : 'var(--panel-2)'} stroke="var(--border)" />
            ))}
          </Bar>
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}
