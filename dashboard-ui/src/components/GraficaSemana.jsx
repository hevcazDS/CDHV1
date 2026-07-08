import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Cell, CartesianGrid } from 'recharts';

// modo: 'barras' | 'linea'
export default function GraficaSemana({ dias = [], fmtMoneda, altura = 200, modo = 'barras' }) {
  const maxN = Math.max(1, ...dias.map(d => d.n));

  const ejes = (
    <>
      <CartesianGrid stroke="var(--border)" vertical={false} />
      <XAxis dataKey="label" stroke="var(--text-mute)" fontSize={11} tickLine={false} axisLine={false} />
      <YAxis stroke="var(--text-mute)" fontSize={11} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
    </>
  );
  const tooltip = (
    <Tooltip
      cursor={{ fill: 'var(--accent-soft)' }}
      contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, boxShadow: 'var(--shadow)' }}
      labelStyle={{ color: 'var(--text)', fontWeight: 600 }}
      formatter={(v, name, item) => [`${v} pedido${v === 1 ? '' : 's'} · ${fmtMoneda(item?.payload?.t || 0)}`, null]}
    />
  );

  return (
    <ResponsiveContainer width="100%" height={altura}>
      {modo === 'linea' ? (
        <LineChart data={dias}>
          {ejes}{tooltip}
          <Line type="monotone" dataKey="n" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 4, fill: 'var(--accent)', strokeWidth: 0 }} />
        </LineChart>
      ) : (
        <BarChart data={dias} barCategoryGap="28%">
          {ejes}{tooltip}
          <Bar dataKey="n" radius={[10, 10, 6, 6]}>
            {dias.map(d => (
              <Cell key={d.dia} fill={d.n === maxN && d.n > 0 ? 'var(--accent)' : 'var(--panel-2)'} stroke="var(--border)" />
            ))}
          </Bar>
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}
