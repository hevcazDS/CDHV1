import { ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, Cell, CartesianGrid } from 'recharts';

// modo: 'barras' | 'linea'
// Colores por token con fallback: bajo el tema F --graf-bar/--graf-hoy pintan
// barras de tinta con HOY en bermellón (REDISENO_UI_F.md §4.2); en el clásico
// caen a panel-2/accent como siempre. La ÚLTIMA barra es "hoy" (la serie del
// backend termina en el día actual). Entrada ANIMADA (recharts) + fade del
// contenedor vía CSS (.grafica-anim, respeta prefers-reduced-motion).
export default function GraficaSemana({ dias = [], fmtMoneda, altura = 200, modo = 'barras' }) {
  const iHoy = dias.length - 1;

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
      <ResponsiveContainer width="100%" height={altura} className="grafica-anim">
        {modo === 'area' ? (
          <AreaChart data={dias}>
            {ejes}{tooltip}
            <Area type="monotone" dataKey="n" stroke="var(--graf-bar, var(--accent))" strokeWidth={1.8}
              fill="var(--graf-bar, var(--accent))" fillOpacity={0.07}
              dot={false} activeDot={{ r: 4, fill: 'var(--graf-hoy, var(--accent))', strokeWidth: 0 }}
              animationDuration={900} animationEasing="ease-out" />
          </AreaChart>
        ) : modo === 'linea' ? (
          <LineChart data={dias}>
            {ejes}{tooltip}
            <Line type="monotone" dataKey="n" stroke="var(--graf-hoy, var(--accent))" strokeWidth={2}
              dot={{ r: 3, fill: 'var(--graf-hoy, var(--accent))', strokeWidth: 0 }}
              animationDuration={900} animationEasing="ease-out" />
          </LineChart>
        ) : (
          <BarChart data={dias} barCategoryGap="28%">
            {ejes}{tooltip}
            <Bar dataKey="n" radius={[2, 2, 0, 0]} animationDuration={900} animationEasing="ease-out">
              {dias.map((d, i) => (
                <Cell key={d.dia}
                  fill={i === iHoy ? 'var(--graf-hoy, var(--accent))' : 'var(--graf-bar, var(--panel-2))'}
                  stroke={i === iHoy ? 'none' : 'var(--border)'} />
              ))}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
  );
}
