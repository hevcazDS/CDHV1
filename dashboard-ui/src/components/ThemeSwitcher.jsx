import { useEffect, useState } from 'react';
import { SegmentedControl, useMantineColorScheme } from '@mantine/core';

const OPCIONES = [
  { value: 'claro', label: 'Claro' },
  { value: 'color', label: 'Color' },
  { value: 'oscuro', label: 'Oscuro' },
];

const STORAGE_KEY = 'jc-tema-modo';

// 'claro' = light monocromo; 'color' = light + data-tema="color" (gradientes);
// 'oscuro' = dark. Valores legacy (light/dark/confort) se mapean.
const LEGACY = { light: 'claro', dark: 'oscuro', confort: 'oscuro' };

export default function ThemeSwitcher() {
  const { setColorScheme } = useMantineColorScheme();
  const [modo, setModo] = useState(() => {
    const v = localStorage.getItem(STORAGE_KEY) || 'claro';
    return LEGACY[v] || v;
  });

  const esTemaF = document.documentElement.getAttribute('data-tema-ui') !== 'clasico';

  useEffect(() => {
    // Bajo el tema F (rediseño) las variantes claro/color/oscuro pertenecen al
    // CLÁSICO (REDISENO_UI_F.md §5): se fuerza esquema claro y el switcher se oculta.
    if (esTemaF) {
      setColorScheme('light');
      document.documentElement.setAttribute('data-tema', 'off');
      document.documentElement.setAttribute('data-confort', 'off');
      return;
    }
    setColorScheme(modo === 'oscuro' ? 'dark' : 'light');
    document.documentElement.setAttribute('data-tema', modo === 'color' ? 'color' : 'off');
    document.documentElement.setAttribute('data-confort', 'off');
    localStorage.setItem(STORAGE_KEY, modo);
  }, [modo, esTemaF]);

  if (esTemaF) return null;
  return (
    <SegmentedControl size="xs" value={modo} onChange={setModo} data={OPCIONES} />
  );
}
