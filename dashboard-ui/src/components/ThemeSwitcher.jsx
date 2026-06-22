import { useEffect, useState } from 'react';
import { SegmentedControl, useMantineColorScheme } from '@mantine/core';

const OPCIONES = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
  { value: 'confort', label: 'Confort' },
];

const STORAGE_KEY = 'jc-tema-modo';

// "Confort" no es un tercer colorScheme de Mantine (solo soporta light/dark)
// -- es colorScheme='dark' + el atributo data-confort="on" en <html>, que
// styles.css usa para bajar contraste/brillo (grises cálidos en vez de
// negro puro). Se guarda en localStorage aparte porque Mantine solo
// persiste light/dark, no este tercer modo.
export default function ThemeSwitcher() {
  const { setColorScheme } = useMantineColorScheme();
  const [modo, setModo] = useState(() => localStorage.getItem(STORAGE_KEY) || 'dark');

  useEffect(() => {
    setColorScheme(modo === 'light' ? 'light' : 'dark');
    document.documentElement.setAttribute('data-confort', modo === 'confort' ? 'on' : 'off');
    localStorage.setItem(STORAGE_KEY, modo);
  }, [modo]);

  return (
    <SegmentedControl
      size="xs"
      value={modo}
      onChange={setModo}
      data={OPCIONES}
    />
  );
}
