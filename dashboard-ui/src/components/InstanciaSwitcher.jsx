// InstanciaSwitcher — selector de tienda (una BD por tienda). Solo Prime y
// solo si existe más de una instancia (instancias/*.db creadas con
// scripts/crearInstanciaDemo.js). Abrir otra tienda reinicia el dashboard
// (~4 s, pm2) y se vuelve al login de ESA tienda: cada una tiene sus propios
// usuarios, catálogo y datos.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select } from '@mantine/core';
import { Store } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { confirmar, toastErr } from '../lib/ui';

export default function InstanciaSwitcher() {
  const { user } = useAuth();
  const [cambiando, setCambiando] = useState(false);
  const { data } = useQuery({
    queryKey: ['instancias'],
    queryFn: () => api.get('/api/instancias').catch(() => null),
    enabled: user?.rol === 'prime',
    staleTime: 60000,
  });
  const instancias = data?.instancias || [];
  if (user?.rol !== 'prime' || instancias.length < 2) return null;

  const activa = instancias.find(i => i.activa);
  const abrir = async (clave) => {
    if (!clave || clave === activa?.clave) return;
    const destino = instancias.find(i => i.clave === clave);
    const ok = await confirmar({
      titulo: 'Cambiar de tienda',
      mensaje: `Se abrirá "${destino?.nombre || clave}" (reinicio de ~4 segundos) y entrarás con los usuarios de ESA tienda. ¿Continuar?`,
    });
    if (!ok) return;
    setCambiando(true);
    try {
      await api.post('/api/instancias/abrir', { clave });
    } catch (_) { /* el proceso muere a media respuesta a veces — es normal */ }
    // Esperar a que el server vuelva y recargar (caerá al login de la tienda)
    const espera = (ms) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 20; i++) {
      await espera(1500);
      try { await fetch('/api/onboarding/estado'); window.location.href = '/'; return; } catch (_) {}
    }
    setCambiando(false);
    toastErr('El dashboard no volvió a responder — revisa pm2');
  };

  if (cambiando) {
    return <span style={{ fontSize: 12, color: 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Store size={14} /> Cambiando de tienda…
    </span>;
  }
  return (
    <Select
      size="xs" w={190} value={activa?.clave || 'principal'} onChange={abrir}
      leftSection={<Store size={13} />} allowDeselect={false}
      data={instancias.map(i => ({ value: i.clave, label: (i.nombre || i.archivo) + (i.giro ? ` · ${i.giro}` : '') }))}
      comboboxProps={{ withinPortal: true }}
      title="Tienda abierta (cada tienda tiene su propia base de datos)"
    />
  );
}
