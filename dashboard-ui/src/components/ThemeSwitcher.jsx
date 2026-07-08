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

  useEffect(() => {
    setColorScheme(modo === 'oscuro' ? 'dark' : 'light');
    document.documentElement.setAttribute('data-tema', modo === 'color' ? 'color' : 'off');
    document.documentElement.setAttribute('data-confort', 'off');
    localStorage.setItem(STORAGE_KEY, modo);
  }, [modo]);

  return (
    <SegmentedControl size="xs" value={modo} onChange={setModo} data={OPCIONES} />
  );
}
