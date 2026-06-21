import { Modal as MantineModal } from '@mantine/core';

// Los 3 consumidores (Pedidos/Devoluciones/Preventas) montan este componente
// condicionalmente (`{ticket && <Modal ...>}`) en vez de mantenerlo montado
// con un prop `opened` que cambia — por eso aquí `opened` siempre es `true`:
// quien decide si se ve es el padre, no este componente.
export default function Modal({ title, onClose, actions, children }) {
  return (
    <MantineModal opened onClose={onClose} title={title} centered radius="md">
      {children}
      <div className="modal-actions">{actions}</div>
    </MantineModal>
  );
}
