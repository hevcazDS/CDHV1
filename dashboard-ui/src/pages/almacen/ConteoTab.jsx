import { useState } from 'react';
import { Card, Button, TextInput, Textarea, Text } from '@mantine/core';
import { api } from '../../api';
import { handleApiError } from '../../lib/apiError';
import { prompt as pedir, toastOk } from '../../lib/ui';
import { exportarCSV } from '../../lib/csv';

// Conteo físico contra archivo: CSV/TXT con "upc,cantidad" (o solo UPCs
// escaneados uno por línea — se agrupan solos). Compara vs BD y aplica
// ajustes con kardex; los ajustes a la baja piden PIN del administrador.
export default function ConteoTab() {
  const [sucursal, setSucursal] = useState('');
  const [texto, setTexto] = useState('');
  const [resultado, setResultado] = useState(null);
  const [cargando, setCargando] = useState(false);

  const leerArchivo = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setTexto(String(r.result || ''));
    r.readAsText(f);
  };

  const comparar = async () => {
    const mapa = new Map();
    for (const linea of texto.split(/\r?\n/)) {
      const [upc, cant] = linea.split(/[,;\t]/).map(x => (x || '').trim());
      if (!upc || /upc/i.test(upc)) continue;
      mapa.set(upc, (mapa.get(upc) || 0) + (cant !== undefined && cant !== '' ? parseInt(cant, 10) || 0 : 1));
    }
    const lineas = [...mapa.entries()].map(([upc, cantidad]) => ({ upc, cantidad }));
    if (!sucursal.trim() || !lineas.length) return handleApiError(new Error('Falta sucursal o el archivo está vacío'));
    setCargando(true);
    try {
      const r = await api.post('/api/almacen/conteo', { sucursal: sucursal.trim(), lineas });
      if (!r.ok) throw new Error(r.error);
      setResultado(r);
    } catch (e) { handleApiError(e); } finally { setCargando(false); }
  };

  const aplicar = async () => {
    const conDiferencia = resultado.resultado.filter(x => x.diferencia !== 0);
    const hayBajas = conDiferencia.some(x => x.diferencia < 0);
    const pin = hayBajas ? await pedir({ titulo: 'Autorización', mensaje: 'Hay ajustes A LA BAJA — PIN de autorización del administrador:', tipo: 'password' }) : undefined;
    if (hayBajas && !pin) return;
    try {
      const r = await api.post('/api/almacen/conteo/aplicar', { sucursal: resultado.sucursal, ajustes: conDiferencia, pin });
      if (!r.ok) throw new Error(r.error);
      toastOk(`${r.aplicados} ajuste(s) aplicados con kardex`);
      setResultado(null); setTexto('');
    } catch (e) { handleApiError(e); }
  };

  const difs = resultado?.resultado?.filter(x => x.diferencia !== 0) || [];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 20, alignItems: 'start' }}>
      <Card withBorder radius="md" p="lg" className="card">
        <div className="card-header"><h3>Archivo de conteo</h3></div>
        <TextInput label="Sucursal / bodega *" value={sucursal} onChange={e => setSucursal(e.target.value)} mb="sm" />
        <Button variant="default" size="xs" mb="sm" component="a"
          href={'/api/almacen/plantilla-conteo?sucursal=' + encodeURIComponent(sucursal.trim())}>
          Descargar plantilla con MI inventario (para el cruce)
        </Button>
        <input type="file" accept=".csv,.txt" onChange={leerArchivo} style={{ marginBottom: 10, display: 'block' }} />
        <Textarea label="O pega aquí (upc,cantidad — o un UPC por línea escaneado)" minRows={7}
          value={texto} onChange={e => setTexto(e.target.value)} mb="md" styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }} />
        <Button fullWidth onClick={comparar} loading={cargando} disabled={!texto.trim()}>Comparar contra la base de datos</Button>
      </Card>

      <Card withBorder radius="md" p="lg" className="card">
        <div className="card-header">
          <h3>Diferencias</h3>
          {resultado && <Text size="xs" c="dimmed">{resultado.resultado.length} códigos · {difs.length} con diferencia · {resultado.no_encontrados.length} no encontrados</Text>}
        </div>
        {!resultado && <div className="empty">Sube o pega el conteo y compara</div>}
        {resultado && (
          <>
            <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
              <table>
                <thead><tr><th>Producto</th><th>Sistema</th><th>Físico</th><th>Diferencia</th></tr></thead>
                <tbody>
                  {difs.length === 0 && <tr><td colSpan={4} className="empty">Todo cuadra — sin diferencias</td></tr>}
                  {difs.map(x => (
                    <tr key={x.id_producto}>
                      <td><strong>{x.name}</strong> <span className="text-muted" style={{ fontSize: 11 }}>{x.upc}</span></td>
                      <td>{x.sistema}</td><td>{x.fisico}</td>
                      <td style={{ color: x.diferencia < 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>{x.diferencia > 0 ? '+' : ''}{x.diferencia}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {resultado.no_encontrados.length > 0 && (
              <Text size="xs" c="red" mt="sm">UPCs no encontrados: {resultado.no_encontrados.join(', ')}</Text>
            )}
            {difs.length > 0 && (
              <>
                <Button fullWidth mt="md" onClick={aplicar}>Aplicar ajustes (kardex auditado)</Button>
                <Button fullWidth mt="xs" variant="default" onClick={() => exportarCSV('conteo_diferencias_' + resultado.sucursal,
                  ['upc', 'producto', 'sistema', 'fisico', 'diferencia'],
                  difs.map(x => [x.upc, x.name, x.sistema, x.fisico, x.diferencia]))}>
                  Exportar diferencias (CSV)
                </Button>
              </>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
