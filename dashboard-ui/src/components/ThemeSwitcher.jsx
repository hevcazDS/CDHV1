import { useEffect, useState } from 'react';
import { SegmentedControl, useMantineColorScheme } from '@mantine/core';

const OPCIONES = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
  { value: 'confort', label: 'Confort' },
];

const STORAGE_KEY = 'jc-tema-modo';

// 'confort' no es un colorScheme de Mantine (solo hay light/dark): es dark +
// data-confort="on" en <html>, que styles.css usa para bajar contraste
export default function ThemeSwitcher() {
  const { setColorScheme } = useMantineColorScheme();
  const [modo, setModo] = useState(() => localStorage.getItem(STORAGE_KEY) || 'light');

  useEffect(() => {
    setColorScheme(modo === 'light' ? 'light' : 'dark');
    document.documentElement.setAttribute('data-confort', modo === 'confort' ? 'on' : 'off');
    localStorage.setItem(STORAGE_KEY, modo);
  }, [modo]);

  return (
    <SegmentedControl size="xs" value={modo} onChange={setModo} data={OPCIONES} />
  );
}
