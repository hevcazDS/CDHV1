import { Menu, UnstyledButton } from '@mantine/core';
import { ChevronDown } from 'lucide-react';

// EstatusMenu — estatus como PUNTO + PALABRA con menú para cambiarlo (esencia F:
// nada de <select> nativo ni pastillas). Usa tokens del tema, así también se ve
// bien en el clásico. value/opciones/onChange como un Select normal.
const COLOR = {
  pendiente: 'var(--text-mute)',
  confirmado: 'var(--info)',
  preparando: 'var(--yellow)',
  enviado: 'var(--info)',
  entregado: 'var(--green)',
  cancelado: 'var(--red)',
  pagado: 'var(--green)',
  generado: 'var(--yellow)',
  expirado: 'var(--red)',
};

export default function EstatusMenu({ value, opciones = [], onChange, disabled = false }) {
  const dot = COLOR[value] || 'var(--text-mute)';
  return (
    <Menu position="bottom-start" withinPortal shadow="md" disabled={disabled}>
      <Menu.Target>
        <UnstyledButton
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}
          title="Cambiar estatus"
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flex: 'none' }} />
          {value || '—'}
          {!disabled && <ChevronDown size={12} style={{ opacity: .45 }} />}
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        {opciones.map(op => (
          <Menu.Item key={op} disabled={op === value} onClick={() => onChange(op)}
            leftSection={<span style={{ width: 7, height: 7, borderRadius: '50%', background: COLOR[op] || 'var(--text-mute)', display: 'inline-block' }} />}>
            {op}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
