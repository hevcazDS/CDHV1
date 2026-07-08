import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid } from 'recharts';

export default function GraficaSemana({ dias, fmtMoneda }) {
  const maxN = Math.max(1, ...dias.map(d => d.n));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={dias} barCategoryGap="28%">
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" stroke="var(--text-mute)" fontSize={11} tickLine={false} axisLine={false} />
        <YAxis stroke="var(--text-mute)" fontSize={11} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: 'var(--accent-soft)' }}
          contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, boxShadow: 'var(--shadow)' }}
          labelStyle={{ color: 'var(--text)', fontWeight: 600 }}
          formatter={(v, name, item) => [`${v} pedido${v === 1 ? '' : 's'} · ${fmtMoneda(item?.payload?.t || 0)}`, null]}
        />
        <Bar dataKey="n" radius={[8, 8, 4, 4]}>
          {dias.map(d => (
            <Cell key={d.dia} fill={d.n === maxN && d.n > 0 ? 'var(--accent)' : 'var(--panel-2)'} stroke="var(--border)" />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
