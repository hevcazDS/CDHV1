// DatosLLMTab.jsx — Tab "Datos LLM" de Prime (soloPrime): exporta el dataset
// conversacional etiquetado por correo (backup) para entrenar un LLM aparte.
import { useState } from 'react';
import { Card, Title, Button } from '@mantine/core';
import { api } from '../../api';
import { useTextoEmoji } from '../../context/EmojiContext';

export default function DatosLLMTab() {
  const txt = useTextoEmoji();
  const [exportando, setExportando] = useState(false);
  const [msg, setMsg] = useState('');

  const exportar = async () => {
    setMsg('');
    setExportando(true);
    try {
      const d = await api.post('/api/prime/exportar-llm', {});
      if (d.ok) {
        setMsg(`Enviado a ${d.destino} — ${d.conversaciones} conversaciones, ${d.mensajes} mensajes, ${d.fallbacks} fallback (${Math.round(d.bytes / 1024)} KB).`);
      } else {
        setMsg(`${d.error || 'No se pudo exportar.'}`);
      }
    } catch (e) { setMsg(`${e.message}`); }
    finally { setExportando(false); }
  };

  return (
    <Card withBorder radius="md" p="lg">
      <Title order={4} mb={4}>Exportar datos para el LLM</Title>
      <p className="page-sub" style={{ margin: '4px 0 16px' }}>
        El bot va guardando cada conversación etiquetada (paso del flujo, intención y en qué
        terminó: venta/escalada/queja/abandono) y el texto que no supo entender. Esto saca esa
        información del servidor y la manda <strong>por correo como respaldo</strong> al destino
        de backups (Prime &gt; General → Contacto y backups), en un archivo JSONL comprimido.
      </p>
      <p className="page-sub" style={{ margin: '4px 0 16px' }}>
        El entrenamiento del modelo se hace <strong>aparte, fuera de producción</strong>: aquí no
        se entrena nada ni se conecta ningún LLM. El teléfono del cliente se envía enmascarado.
        Solo el usuario prime ve y dispara esta tarea.
      </p>
      {msg && <div className="card" style={{ marginBottom: 12 }}>{msg}</div>}
      <Button onClick={exportar} loading={exportando}>
        {txt('📤 Exportar y enviar por correo')}
      </Button>
    </Card>
  );
}
