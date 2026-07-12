// Skeleton loaders (SPEC_MOTION_UI §C): shimmer en lugar del "Cargando..." de
// texto. Reemplazo mecánico del patrón `rows === undefined && <td>Cargando...`.
export function SkelRows({ cols, rows = 5 }) {
  return Array.from({ length: rows }, (_, i) => (
    <tr key={i} className="skel-row">
      {Array.from({ length: cols }, (_, j) => <td key={j}><span className="skel" /></td>)}
    </tr>
  ));
}
export function SkelBlock({ height = 120 }) {
  return <span className="skel skel-block" style={{ height }} />;
}
