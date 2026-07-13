// MotorCanvas — lienzo visual del motor de flujo (tipo ComfyUI) con React Flow.
// Nodos = pasos del grafo; aristas = transiciones etiquetadas por su matcher
// (`input`). Los nodos SELLADOS (sistema/delegados) se ven con candado y no se
// pueden borrar ni recablear su lógica — el servidor lo re-valida de todos modos
// (PUT /api/prime/motor/grafo lintea y aplica la frontera §D antes de persistir).
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position,
  useNodesState, useEdgesState, addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button, Group, Badge, TextInput, Textarea, Text, Card } from '@mantine/core';
import { Lock, Plus, Save } from 'lucide-react';
import { api } from '../../api';
import { handleApiError } from '../../lib/apiError';
import { toastOk, toastErr } from '../../lib/ui';

// ── Nodo custom (estética de tarjeta oscura, badges, candado) ────────────────
function PasoNode({ data, selected }) {
  const sellado = data.sellado;
  return (
    <div style={{
      background: sellado ? '#2b2d31' : '#1f2937',
      border: `1.5px solid ${selected ? '#7c6cf0' : sellado ? '#4b4d52' : '#374151'}`,
      borderRadius: 10, padding: '10px 12px', minWidth: 170, color: '#e5e7eb',
      fontSize: 12, boxShadow: selected ? '0 0 0 2px rgba(124,108,240,.25)' : 'none',
    }}>
      <Handle type="target" position={Position.Left} style={{ background: '#7c6cf0' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <strong style={{ fontFamily: 'monospace', fontSize: 12 }}>{data.paso}</strong>
        {data.es_inicial ? <span title="nodo inicial">⭐</span> : null}
        {sellado && <Lock size={11} color="#9ca3af" title="sellado: lógica no editable" />}
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: data.tipo === 'sistema' ? '#7c2d12' : '#1e3a5f', color: '#fca5a5' + (data.tipo === 'sistema' ? '' : '') , ...(data.tipo !== 'sistema' && { color: '#93c5fd' }) }}>{data.tipo}</span>
        {data.delegar && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: '#374151', color: '#d1d5db' }}>delegado</span>}
        {data.render && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: '#4c1d95', color: '#ddd6fe' }}>render</span>}
        {data.params?.porcentaje != null && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: '#14532d', color: '#bbf7d0' }}>{data.params.porcentaje}%</span>}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: '#22c55e' }} />
    </div>
  );
}
const nodeTypes = { paso: PasoNode };

// Layout por defecto cuando no hay pos guardada: rejilla simple.
// ponytail: rejilla fija; un dagre/BFS por capas si algún grafo real lo pide.
const autoPos = (i) => ({ x: 60 + (i % 4) * 240, y: 60 + Math.floor(i / 4) * 150 });

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
      id: 'e' + i, source: a.paso, target: a.destino, label: a.input,
      animated: a.input?.startsWith('resultado:'),
      style: { stroke: '#8b8f98' }, labelStyle: { fontSize: 10, fontFamily: 'monospace' },
      data: { ...a },
    }));
    return { nodes, edges };
  }, [data]);

  const [nodes, setNodes, onNodesChange] = useNodesState(inicial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(inicial.edges);
  const [sel, setSel] = useState(null);           // nodo seleccionado (para el panel)
  const [dirty, setDirty] = useState(false);

  const marcar = (fn) => (...args) => { setDirty(true); return fn(...args); };

  // Conectar dos nodos = nueva arista; el matcher se pide al momento.
  const onConnect = useCallback((con) => {
    const input = window.prompt('Matcher de la transición (ej: 1, kw:cita, regex:^\\d{5}$, resultado:hay, *):', '*');
    if (input == null || input === '') return;
    setDirty(true);
    setEdges(eds => addEdge({ ...con, label: input, data: { input }, labelStyle: { fontSize: 10, fontFamily: 'monospace' }, style: { stroke: '#8b8f98' } }, eds));
  }, [setEdges]);

  // Doble clic en arista = editar su matcher.
  const onEdgeDoubleClick = useCallback((_, edge) => {
    const input = window.prompt('Matcher de la transición:', edge.data?.input || edge.label || '*');
    if (input == null || input === '') return;
    setDirty(true);
    setEdges(eds => eds.map(e => e.id === edge.id ? { ...e, label: input, data: { ...e.data, input } } : e));
  }, [setEdges]);

  // Evitar borrar nodos sellados (además de deletable:false, por si acaso).
  const onBeforeDelete = useCallback(async ({ nodes: del }) => {
    if (del.some(n => n.data?.sellado)) { toastErr('Los nodos sellados no se pueden borrar'); return false; }
    setDirty(true);
    return true;
  }, []);

  const agregarNodo = () => {
    const paso = window.prompt('Nombre del paso nuevo (MAYÚSCULAS_Y_GUIONES, ej: PROMO_BIENVENIDA):');
    if (!paso || !/^[A-Z0-9_]+$/i.test(paso)) return paso != null && toastErr('Nombre inválido');
    if (nodes.some(n => n.id === paso.toUpperCase())) return toastErr('Ya existe ese paso');
    const p = paso.toUpperCase();
    setDirty(true);
    setNodes(ns => [...ns, {
      id: p, type: 'paso', position: { x: 120, y: 120 },
      deletable: true,
      data: { paso: p, tipo: 'conversacion', frase_clave: null, params: {}, es_inicial: false, sellado: false },
    }]);
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
        input: e.data?.input || String(e.label || '*'), destino: e.target,
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

  // Panel de propiedades del nodo seleccionado.
  const actualizarSel = (campo, valor) => {
    setDirty(true);
    setNodes(ns => ns.map(n => n.id === sel ? { ...n, data: { ...n.data, [campo]: valor } } : n));
  };
  const nodoSel = nodes.find(n => n.id === sel);

  return (
    <div>
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <Button size="xs" variant="default" leftSection={<Plus size={14} />} onClick={agregarNodo}>Agregar nodo</Button>
          <Text size="xs" c="dimmed">Arrastra para conectar · doble clic en un cable edita su condición · Supr borra</Text>
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
              {nodoSel.data.sellado && <Badge size="xs" color="gray" leftSection={<Lock size={9} />}>sellado</Badge>}
            </Group>
            <TextInput label="Frase (clave de texto)" size="xs" mb="xs"
              value={nodoSel.data.frase_clave || ''} placeholder="ej: menu_opciones"
              onChange={e => actualizarSel('frase_clave', e.target.value || null)} />
            <Textarea label="Parámetros (JSON)" size="xs" autosize minRows={3}
              value={JSON.stringify(nodoSel.data.params || {}, null, 1)}
              disabled={nodoSel.data.sellado && nodoSel.data.delegar}
              onChange={e => { try { actualizarSel('params', JSON.parse(e.target.value)); } catch (_) { /* JSON a medias mientras teclea */ } }} />
            <Text size="xs" c="dimmed" mt={6}>
              {nodoSel.data.sellado
                ? 'Nodo sellado: su lógica corre en código. Solo posición, frase y params permitidos.'
                : 'El texto que ve el cliente se edita en "Editor del bot" con esta clave de frase.'}
            </Text>
          </Card>
        )}
      </div>
    </div>
  );
}
