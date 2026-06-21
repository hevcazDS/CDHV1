import { SegmentedControl, useMantineColorScheme } from '@mantine/core';

const OPCIONES = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
  { value: 'auto', label: 'Auto' },
];

export default function ThemeSwitcher() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <SegmentedControl
      size="xs"
      value={colorScheme}
      onChange={setColorScheme}
      data={OPCIONES}
    />
  );
}
