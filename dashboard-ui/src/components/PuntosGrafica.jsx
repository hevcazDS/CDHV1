// Puntitos para cambiar el estilo de una gráfica (barras/línea/%)
export default function PuntosGrafica({ opciones, valor, onChange }) {
  return (
    <div className="dots">
      {opciones.map(o => (
        <button
          key={o.value} type="button" title={o.label} aria-label={o.label}
          className={`dot${valor === o.value ? ' activo' : ''}`}
          onClick={() => onChange(o.value)}
        />
      ))}
    </div>
  );
}
