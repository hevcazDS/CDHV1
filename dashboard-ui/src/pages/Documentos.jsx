import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Button, TextInput, NumberInput, Group, Text, Select, SegmentedControl, Textarea, Collapse } from '@mantine/core';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';
import { toastOk } from '../lib/ui';
import { money } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { tieneRango } from '../lib/roles';

// F5.2 — Documentos: cotizaciones, pagarés y contratos con plantillas estándar
// + plantilla propia por sucursal. El documento se emite (render de la plantilla)
// y se imprime. Requiere el módulo documentos_activo.
const TIPOS = [{ value: 'cotizacion', label: 'Cotización' }, { value: 'pagare', label: 'Pagaré' }, { value: 'contrato', label: 'Contrato' }];
const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export default function Documentos() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const esGerente = tieneRango(user?.rol, 'gerente');
  const [tipo, setTipo] = useState('cotizacion');
  const [form, setForm] = useState({ id_plantilla: null, contraparte_nombre: '', contraparte_ref: '', concepto: '', monto: '' });
  const [nuevaPl, setNuevaPl] = useState({ abierto: false, nombre: '', cuerpo: '' });

  const { data: pl } = useQuery({ queryKey: ['doc-plantillas', tipo], queryFn: () => api.get(`/api/documentos/plantillas?tipo=${tipo}`) });
  const { data: docs } = useQuery({ queryKey: ['documentos', tipo], queryFn: () => api.get(`/api/documentos?tipo=${tipo}`) });
  const plantillas = pl?.plantillas || [];
  const off = pl && pl.ok === false;
  const documentos = docs?.documentos || [];

  const imprimir = (contenido, titulo) => {
    const w = window.open('', '_blank', 'width=760,height=860');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title>
      <style>body{font-family:system-ui,Arial,sans-serif;max-width:680px;margin:32px auto;color:#111;line-height:1.6;white-space:pre-wrap;font-size:14px}</style>
      </head><body>${esc(contenido)}<script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  };

  const emitir = async () => {
    if (!form.id_plantilla) return handleApiError(new Error('Elige una plantilla'));
    if (!form.contraparte_nombre.trim()) return handleApiError(new Error('Falta el nombre de la contraparte'));
    const r = await api.post('/api/documentos', { tipo, ...form, id_plantilla: Number(form.id_plantilla), monto: Number(form.monto) || 0 }).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) return handleApiError(new Error(r.error));
    toastOk(`Documento emitido · ${r.folio}`);
    imprimir(r.contenido, tipo + ' ' + r.folio);
    setForm({ id_plantilla: form.id_plantilla, contraparte_nombre: '', contraparte_ref: '', concepto: '', monto: '' });
    qc.invalidateQueries({ queryKey: ['documentos'] });
  };
  const guardarPlantilla = async () => {
    if (!nuevaPl.nombre.trim() || !nuevaPl.cuerpo.trim()) return handleApiError(new Error('Nombre y cuerpo requeridos'));
    const r = await api.post('/api/documentos/plantillas', { tipo, nombre: nuevaPl.nombre, cuerpo: nuevaPl.cuerpo }).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) return handleApiError(new Error(r.error));
    toastOk('Plantilla guardada'); setNuevaPl({ abierto: false, nombre: '', cuerpo: '' });
    qc.invalidateQueries({ queryKey: ['doc-plantillas'] });
  };
  const abrir = async (id) => {
    const r = await api.get(`/api/documentos/${id}`).catch(() => null);
    if (r?.ok) imprimir(r.documento.contenido, r.documento.tipo + ' ' + r.documento.folio);
  };

  return (
    <div>
      <div className="page-title">Documentos</div>
      <div className="page-sub">Cotizaciones, pagarés y contratos — plantillas estándar o la de tu sucursal</div>
      <SegmentedControl mb="md" value={tipo} onChange={setTipo} data={TIPOS} />

      {off ? (
        <Card withBorder radius="md" p="lg" className="card"><Text size="sm" c="dimmed">Activa el módulo <strong>Documentos</strong> en Módulos para emitir cotizaciones, pagarés y contratos.</Text></Card>
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 20, alignItems: 'start' }}>
        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Emitir {TIPOS.find(t => t.value === tipo)?.label}</h3></div>
          <Select label="Plantilla *" mb="sm" value={form.id_plantilla} onChange={v => setForm({ ...form, id_plantilla: v })}
            data={plantillas.map(p => ({ value: String(p.id), label: p.nombre + (p.sucursal ? ' (sucursal)' : ' (estándar)') }))} />
          <TextInput label="Contraparte *" placeholder="Cliente / proveedor / empleado" value={form.contraparte_nombre} onChange={e => setForm({ ...form, contraparte_nombre: e.target.value })} mb="sm" />
          <Group grow mb="sm">
            <TextInput label="Referencia (RFC / tel / folio)" value={form.contraparte_ref} onChange={e => setForm({ ...form, contraparte_ref: e.target.value })} />
            <NumberInput label="Monto" min={0} decimalScale={2} value={form.monto} onChange={v => setForm({ ...form, monto: v })} />
          </Group>
          <TextInput label="Concepto" value={form.concepto} onChange={e => setForm({ ...form, concepto: e.target.value })} mb="md" />
          <Button fullWidth onClick={emitir}>Emitir e imprimir</Button>

          {esGerente && (
            <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <Button variant="subtle" size="xs" onClick={() => setNuevaPl({ ...nuevaPl, abierto: !nuevaPl.abierto })}>
                {nuevaPl.abierto ? '− ' : '+ '}Plantilla propia de la sucursal
              </Button>
              <Collapse in={nuevaPl.abierto}>
                <Text size="xs" c="dimmed" my={6}>Usa {'{{negocio}} {{sucursal}} {{fecha}} {{contraparte}} {{ref}} {{monto}} {{monto_letra}} {{concepto}}'} y {'{{n}}'} para salto de línea.</Text>
                <TextInput size="xs" placeholder="Nombre de la plantilla" value={nuevaPl.nombre} onChange={e => setNuevaPl({ ...nuevaPl, nombre: e.target.value })} mb="xs" />
                <Textarea size="xs" minRows={5} autosize placeholder="Cuerpo de la plantilla…" value={nuevaPl.cuerpo} onChange={e => setNuevaPl({ ...nuevaPl, cuerpo: e.currentTarget.value })} mb="xs" />
                <Button size="xs" onClick={guardarPlantilla}>Guardar plantilla</Button>
              </Collapse>
            </div>
          )}
        </Card>

        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Emitidos</h3></div>
          <div className="table-wrap" style={{ maxHeight: 520, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Folio</th><th>Contraparte</th><th className="num">Monto</th><th>Estatus</th><th></th></tr></thead>
              <tbody>
                {documentos.length === 0 && <tr><td colSpan={5} className="empty">Sin documentos de este tipo</td></tr>}
                {documentos.map(d => (
                  <tr key={d.id}>
                    <td><span className="folio">{d.folio}</span></td>
                    <td>{d.contraparte_nombre || '—'}{d.contraparte_ref && <div className="text-muted" style={{ fontSize: 11 }}>{d.contraparte_ref}</div>}</td>
                    <td className="num">{d.monto ? money(d.monto) : '—'}</td>
                    <td><span className="badge">{d.estatus}</span></td>
                    <td><Button size="compact-xs" variant="default" onClick={() => abrir(d.id)}>Imprimir</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      )}
    </div>
  );
}
