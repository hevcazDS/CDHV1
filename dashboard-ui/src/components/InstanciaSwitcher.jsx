// InstanciaSwitcher — selector de tienda (una BD por tienda). Botón prominente
// SIEMPRE visible en el header para Prime cuando hay 2+ instancias, con un menú
// que lista todas las tiendas (incluida la principal, para poder REGRESAR siempre).
// Abrir otra tienda reinicia el dashboard (~4 s, pm2) y se vuelve al login de ESA
// tienda: cada una tiene sus propios usuarios, catálogo y datos.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Menu, Button } from '@mantine/core';
import { Store, ChevronDown, Check, Home } from 'lucide-react';
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

  const activa = instancias.find(i => i.activa) || instancias.find(i => i.clave === 'principal');
  const nombreActiva = (activa?.nombre || activa?.archivo || 'Tienda') + (activa?.giro ? ` · ${activa.giro}` : '');

  const abrir = async (clave) => {
    if (!clave || clave === activa?.clave) return;
    const destino = instancias.find(i => i.clave === clave);
    const ok = await confirmar({
      titulo: 'Cambiar de tienda',
      mensaje: `Se abrirá "${destino?.nombre || clave}" (reinicio de ~4 segundos) y entrarás con los usuarios de ESA tienda. ¿Continuar?`,
    });
    if (!ok) return;
    setCambiando(true);
    try { await api.post('/api/instancias/abrir', { clave }); }
    catch (_) { /* el proceso muere a media respuesta a veces — es normal */ }
    const espera = (ms) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 20; i++) {
      await espera(1500);
      try { await fetch('/api/onboarding/estado'); window.location.href = '/'; return; } catch (_) {}
    }
    setCambiando(false);
    toastErr('El dashboard no volvió a responder — revisa pm2');
  };

  return (
    <Menu shadow="md" width={260} position="bottom-end" withinPortal disabled={cambiando}>
      <Menu.Target>
        <Button
          size="xs" variant="light" radius="xl"
          leftSection={<Store size={15} />} rightSection={<ChevronDown size={14} />}
          loading={cambiando}
          styles={{ root: { fontWeight: 600, maxWidth: 240 }, label: { overflow: 'hidden', textOverflow: 'ellipsis' } }}
          title="Tienda abierta — clic para cambiar (cada tienda tiene su propia base de datos)"
        >
          {cambiando ? 'Cambiando…' : nombreActiva}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Cambiar de tienda</Menu.Label>
        {instancias.map(i => {
          const esActiva = i.activa;
          const label = (i.nombre || i.archivo) + (i.giro ? ` · ${i.giro}` : '');
          return (
            <Menu.Item
              key={i.clave}
              leftSection={i.clave === 'principal' ? <Home size={14} /> : <Store size={14} />}
              rightSection={esActiva ? <Check size={14} /> : null}
              disabled={esActiva}
              onClick={() => abrir(i.clave)}
            >
              {label}{i.clave === 'principal' ? '  (principal)' : ''}
            </Menu.Item>
          );
        })}
      </Menu.Dropdown>
    </Menu>
  );
}
