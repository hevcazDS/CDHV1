// MotorCanvas — lienzo visual del flujo del bot (estilo ComfyUI, React Flow).
// Pensado para una persona SIN conocimiento técnico: las condiciones de los
// cables se eligen en lenguaje llano ("cuando elige la opción 2", "cuando
// escribe la palabra cita", "con cualquier respuesta") y se guardan internamente
// como matchers (input '2' | 'kw:cita' | '*' | 'resultado:x'). Los nodos
// BLOQUEADOS (flujo base) llevan candado; el servidor re-valida todo al guardar.
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position,
  useNodesState, useEdgesState, addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button, Group, Badge, TextInput, Text, Card, Modal, SegmentedControl, NumberInput, Collapse, Textarea, Anchor } from '@mantine/core';
import { Lock, Plus, Save } from 'lucide-react';
import { api } from '../../api';
import { handleApiError } from '../../lib/apiError';
import { toastOk, toastErr } from '../../lib/ui';

// ── Traducción matcher interno ⇄ lenguaje llano ──────────────────────────────
export function humanizar(input) {
  if (!input || input === '*') return 'cualquier respuesta';
  if (/^\d+$/.test(input)) return 'elige la opción ' + input;
  if (input.startsWith('kw:')) return 'escribe "' + input.slice(3) + '"';
  if (input.startsWith('resultado:')) return 'si el resultado es "' + input.slice(10) + '"';
  if (input.startsWith('regex:')) return 'patrón avanzado';
  return 'escribe "' + input + '"';
}

// ── Nodo custom (tarjeta oscura, badges, candado) ────────────────────────────
function PasoNode({ data, selected }) {
  const sellado = data.sellado;
  return (
    <div style={{
      background: sellado ? '#2b2d31' : '#1f2937',
      border: `1.5px solid ${selected ? '#7c6cf0' : sellado ? '#4b4d52' : '#374151'}`,
      borderRadius: 10, padding: '10px 12px', minWidth: 170, color: '#e5e7eb',
      fontSize: 12, boxShadow: selected ? '0 0 0 2px rgba(124,108,240,.25)' : 'none',
    }}>
      <Handle type="target" position={Position.Left} style={{ background: '#7c6cf0', width: 10, height: 10 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <strong style={{ fontFamily: 'monospace', fontSize: 12 }}>{data.paso}</strong>
        {data.es_inicial ? <span title="aquí empieza la conversación">⭐</span> : null}
        {sellado && <Lock size={11} color="#9ca3af" title="parte del flujo base — no se puede borrar" />}
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {sellado
          ? <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: '#374151', color: '#d1d5db' }}>flujo base</span>
          : <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: '#1e3a5f', color: '#93c5fd' }}>personalizado</span>}
        {data.params?.porcentaje != null && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: '#14532d', color: '#bbf7d0' }}>anticipo {data.params.porcentaje}%</span>}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: '#22c55e', width: 10, height: 10 }} />
    </div>
  );
}
const nodeTypes = { paso: PasoNode };

// ponytail: rejilla fija de acomodo inicial; un layout por capas si algún grafo lo pide.
const autoPos = (i) => ({ x: 60 + (i % 4) * 240, y: 60 + Math.floor(i / 4) * 150 });

const ESTILO_CABLE = { stroke: '#8b8f98', strokeWidth: 2 };
const ESTILO_LABEL = { fontSize: 10, fill: '#c9cdd4' };

// ── Modal "¿cuándo se toma este camino?" (crear/editar conexión) ─────────────
function ModalCondicion({ abierto, inicial, onOk, onCancel }) {
  const [tipo, setTipo] = useState('opcion');
  const [valor, setValor] = useState('1');
  const [avanzado, setAvanzado] = useState('');
  const [verAvanzado, setVerAvanzado] = useState(false);

  // sincronizar cuando se abre con un valor existente
  useMemo(() => {
    const inp = inicial || '*';
    if (inp === '*') { setTipo('siempre'); setValor(''); }
    else if (/^\d+$/.test(inp)) { setTipo('opcion'); setValor(inp); }
    else if (inp.startsWith('kw:')) { setTipo('palabra'); setValor(inp.slice(3)); }
    else { setTipo('avanzado'); setAvanzado(inp); setVerAvanzado(true); }
  }, [abierto, inicial]);

  const confirmar = () => {
    let input;
    if (tipo === 'siempre') input = '*';
    else if (tipo === 'opcion') { if (!/^\d+$/.test(String(valor))) return toastErr('Escribe el número de la opción (ej: 2)'); input = String(valor); }
    else if (tipo === 'palabra') { const v = String(valor).trim().toLowerCase(); if (!v) return toastErr('Escribe la palabra'); input = 'kw:' + v; }
    else { const v = String(avanzado).trim(); if (!v) return toastErr('Escribe la condición avanzada'); input = v; }
    onOk(input);
  };

  return (
    <Modal opened={abierto} onClose={onCancel} title="¿Cuándo sigue la conversación por este camino?" size="md" centered>
      <SegmentedControl fullWidth mb="md" value={tipo} onChange={setTipo} data={[
        { value: 'opcion', label: 'Elige una opción' },
        { value: 'palabra', label: 'Escribe una palabra' },
        { value: 'siempre', label: 'Siempre' },
      ]} />
      {tipo === 'opcion' && (
        <NumberInput label="¿Qué número de opción?" description='Cuando el cliente responde con este número (ej: el "2" del menú)' min={0} max={99}
          value={valor === '' ? '' : Number(valor)} onChange={v => setValor(String(v ?? ''))} />
      )}
      {tipo === 'palabra' && (
        <TextInput label="¿Qué palabra?" description='Cuando el mensaje del cliente contiene esta palabra (ej: "cita", "promo")'
          value={valor} onChange={e => setValor(e.target.value)} placeholder="cita" />
      )}
      {tipo === 'siempre' && (
        <Text size="sm" c="dimmed">Con cualquier respuesta del cliente se sigue por este camino. Útil como camino "por defecto".</Text>
      )}
      <Anchor size="xs" mt="sm" component="button" type="button" onClick={() => setVerAvanzado(v => !v)} style={{ display: 'block', marginTop: 12 }}>
        {verAvanzado ? 'Ocultar opciones avanzadas' : 'Opciones avanzadas'}
      </Anchor>
      <Collapse in={verAvanzado}>
        <TextInput size="xs" mt={6} label="Condición técnica (opcional)" description="Para usuarios avanzados: regex:…, resultado:…"
          value={tipo === 'avanzado' ? avanzado : ''} onChange={e => { setTipo('avanzado'); setAvanzado(e.target.value); }} placeholder="regex:^\d{5}$" />
      </Collapse>
      <Group justify="flex-end" mt="lg">
        <Button variant="default" onClick={onCancel}>Cancelar</Button>
        <Button onClick={confirmar}>Aceptar</Button>
      </Group>
    </Modal>
  );
}

export default function MotorCanvas({ data }) {
  const qc = useQueryClient();

  const inicial = useMemo(() => {
    const nodes = data.nodos.map((n, i) => ({
      id: n.paso, type: 'paso',
      position: (Number.isFinite(n.pos_x) && Number.isFinite(n.pos_y)) ? { x: n.pos_x, y: n.pos_y } : autoPos(i),
      deletable: !(n.tipo === 'sistema' || n.delegar),
      data: { ...n, sellado: n.tipo === 'sistema' || n.delegar },
    }));
    const edges = (data.aristas || []).map((a, i) => ({
      id: 'e' + i, source: a.paso, target: a.destino, label: humanizar(a.input),
      animated: a.input?.startsWith('resultado:'),
      style: ESTILO_CABLE, labelStyle: ESTILO_LABEL, labelBgStyle: { fill: '#1a1c22', fillOpacity: 0.9 },
      data: { ...a },
    }));
    return { nodes, edges };
  }, [data]);

  const [nodes, setNodes, onNodesChange] = useNodesState(inicial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(inicial.edges);
  const [sel, setSel] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [modal, setModal] = useState(null);        // { modo:'conectar', con } | { modo:'editar', edgeId, input }
  const [modalNodo, setModalNodo] = useState(false);
  const [nombreNodo, setNombreNodo] = useState('');

  const marcar = (fn) => (...args) => { setDirty(true); return fn(...args); };

  // Conectar: guardar la conexión pendiente y abrir el modal en lenguaje llano.
  const onConnect = useCallback((con) => setModal({ modo: 'conectar', con, input: '*' }), []);
  const onEdgeDoubleClick = useCallback((_, edge) => setModal({ modo: 'editar', edgeId: edge.id, input: edge.data?.input || '*' }), []);

  const confirmarCondicion = (input) => {
    setDirty(true);
    if (modal.modo === 'conectar') {
      setEdges(eds => addEdge({
        ...modal.con, label: humanizar(input), data: { input },
        style: ESTILO_CABLE, labelStyle: ESTILO_LABEL, labelBgStyle: { fill: '#1a1c22', fillOpacity: 0.9 },
      }, eds));
    } else {
      setEdges(eds => eds.map(e => e.id === modal.edgeId ? { ...e, label: humanizar(input), data: { ...e.data, input } } : e));
    }
    setModal(null);
  };

  const onBeforeDelete = useCallback(async ({ nodes: del }) => {
    if (del.some(n => n.data?.sellado)) { toastErr('Esa pieza es parte del flujo base y no se puede borrar'); return false; }
    setDirty(true);
    return true;
  }, []);

  const crearNodo = () => {
    const limpio = nombreNodo.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
    if (!limpio) return toastErr('Escribe un nombre para el paso');
    if (nodes.some(n => n.id === limpio)) return toastErr('Ya existe un paso con ese nombre');
    setDirty(true);
    setNodes(ns => [...ns, {
      id: limpio, type: 'paso', position: { x: 120, y: 120 }, deletable: true,
      data: { paso: limpio, tipo: 'conversacion', frase_clave: null, params: {}, es_inicial: false, sellado: false },
    }]);
    setModalNodo(false); setNombreNodo('');
  };

  const guardar = useMutation({
    mutationFn: () => {
      const nodos = nodes.map(n => ({
        paso: n.id, tipo: n.data.tipo || 'conversacion', frase_clave: n.data.frase_clave || null,
        accion_entrada: n.data.accion_entrada || null, render: n.data.render || null,
        params: n.data.params || {}, es_inicial: !!n.data.es_inicial,
        pos_x: n.position.x, pos_y: n.position.y,
      }));
      const aristas = edges.map((e, i) => ({
        paso: e.source, orden: i + 1, label: e.data?.label || null,
        input: e.data?.input || '*', destino: e.target,
        accion: e.data?.accion || null, params: e.data?.params || {},
      }));
      return api.put('/api/prime/motor/grafo', { nodos, aristas });
    },
    onSuccess: (r) => {
      if (!r.ok) return handleApiError(new Error(r.errs ? r.error + ': ' + r.errs.join('; ') : r.error));
      setDirty(false);
      toastOk('Flujo guardado (versión ' + r.version + ')');
      qc.invalidateQueries({ queryKey: ['prime-motor'] });
    },
    onError: handleApiError,
  });

  const actualizarSel = (campo, valor) => {
    setDirty(true);
    setNodes(ns => ns.map(n => n.id === sel ? { ...n, data: { ...n.data, [campo]: valor } } : n));
  };
  const nodoSel = nodes.find(n => n.id === sel);
  const [verJson, setVerJson] = useState(false);

  return (
    <div>
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <Button size="xs" variant="default" leftSection={<Plus size={14} />} onClick={() => setModalNodo(true)}>Agregar paso</Button>
          <Text size="xs" c="dimmed">Arrastra de un punto verde a uno morado para conectar · doble clic en un cable cambia su condición</Text>
        </Group>
        <Button size="xs" leftSection={<Save size={14} />} disabled={!dirty} loading={guardar.isPending}
          onClick={() => guardar.mutate()}>Guardar flujo</Button>
      </Group>

      <div style={{ display: 'grid', gridTemplateColumns: nodoSel ? '1fr 260px' : '1fr', gap: 12 }}>
        <div style={{ height: 560, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)', background: '#111318' }}>
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={marcar(onNodesChange)} onEdgesChange={marcar(onEdgesChange)}
            onConnect={onConnect} onEdgeDoubleClick={onEdgeDoubleClick}
            onBeforeDelete={onBeforeDelete}
            onSelectionChange={({ nodes: sn }) => setSel(sn?.[0]?.id || null)}
            fitView proOptions={{ hideAttribution: true }}
            colorMode="dark"
            connectionRadius={36}
            snapToGrid snapGrid={[12, 12]}
            connectionLineStyle={{ stroke: '#7c6cf0', strokeWidth: 2 }}
            defaultEdgeOptions={{ style: ESTILO_CABLE }}
          >
            <Background variant="dots" gap={18} size={1} color="#2a2d35" />
            <Controls position="bottom-right" />
            <MiniMap pannable zoomable style={{ background: '#1a1c22' }} nodeColor={(n) => n.data?.sellado ? '#4b4d52' : '#3b4b6b'} />
          </ReactFlow>
        </div>

        {nodoSel && (
          <Card withBorder radius="md" p="md" className="card" style={{ alignSelf: 'start' }}>
            <Group gap={6} mb="xs">
              <Text fw={600} size="sm" style={{ fontFamily: 'monospace' }}>{nodoSel.id}</Text>
              {nodoSel.data.sellado && <Badge size="xs" color="gray" leftSection={<Lock size={9} />}>flujo base</Badge>}
            </Group>

            {nodoSel.data.params?.porcentaje != null && (
              <NumberInput label="% de anticipo" size="xs" mb="xs" min={1} max={100}
                value={nodoSel.data.params.porcentaje}
                onChange={v => actualizarSel('params', { ...nodoSel.data.params, porcentaje: Number(v) })} />
            )}

            {!nodoSel.data.sellado && (
              <TextInput label="Nombre del texto que responde" size="xs" mb="xs"
                description='Se escribe el contenido en la pestaña "Editor del bot"'
                value={nodoSel.data.frase_clave || ''} placeholder="ej: promo_bienvenida"
                onChange={e => actualizarSel('frase_clave', e.target.value || null)} />
            )}

            <Text size="xs" c="dimmed" mt={6}>
              {nodoSel.data.sellado
                ? 'Esta pieza es del flujo base: funciona sola y no se puede borrar. Puedes moverla y conectarle caminos nuevos.'
                : 'Pieza personalizada: conéctala con cables y define cuándo se llega a ella.'}
            </Text>

            <Anchor size="xs" component="button" type="button" onClick={() => setVerJson(v => !v)} style={{ display: 'block', marginTop: 8 }}>
              {verJson ? 'Ocultar detalles técnicos' : 'Detalles técnicos'}
            </Anchor>
            <Collapse in={verJson}>
              <Textarea size="xs" mt={6} autosize minRows={3} label="Parámetros (JSON)"
                value={JSON.stringify(nodoSel.data.params || {}, null, 1)}
                onChange={e => { try { actualizarSel('params', JSON.parse(e.target.value)); } catch (_) { /* JSON a medias */ } }} />
            </Collapse>
          </Card>
        )}
      </div>

      <ModalCondicion abierto={!!modal} inicial={modal?.input} onOk={confirmarCondicion} onCancel={() => setModal(null)} />

      <Modal opened={modalNodo} onClose={() => setModalNodo(false)} title="Agregar un paso al flujo" centered size="sm">
        <TextInput label="Nombre del paso" description="Un nombre corto que lo identifique (ej: PROMOCION, AVISO_ENVIO)"
          value={nombreNodo} onChange={e => setNombreNodo(e.target.value)} placeholder="PROMOCION"
          onKeyDown={e => e.key === 'Enter' && crearNodo()} data-autofocus />
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setModalNodo(false)}>Cancelar</Button>
          <Button onClick={crearNodo}>Agregar</Button>
        </Group>
      </Modal>
    </div>
  );
}
