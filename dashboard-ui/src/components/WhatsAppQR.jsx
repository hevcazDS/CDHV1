import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { QR_POLL_MS } from '../hooks/useWhatsAppQR';
import { useEmoji } from '../context/EmojiContext';

// Dibuja el QR de vinculación de WhatsApp. El bot es OPCIONAL: esto nunca se
// muestra solo — lo abre el usuario a propósito desde BotStatusWidget
// ("Vincular WhatsApp"), nunca aparece automático al loguearse ni al entrar
// a Inicio. onCerrar (opcional): botón ✕ para salir sin tener que escanear.
export default function WhatsAppQR({ qr, pantallaCompleta = false, onCerrar }) {
  const canvasRef = useRef(null);
  const emoji = useEmoji();

  useEffect(() => {
    if (!qr || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, qr, { width: pantallaCompleta ? 280 : 220, color: { dark: '#1a1a2e', light: '#ffffff' } });
  }, [qr, pantallaCompleta]);

  if (!qr) return null;

  const tarjeta = (
    <div
      className="card"
      style={{
        position: 'relative',
        marginBottom: pantallaCompleta ? 0 : 0,
        padding: 24,
        textAlign: 'center',
        borderColor: 'var(--accent)',
        maxWidth: 380,
        background: 'var(--panel)',
      }}
    >
      {onCerrar && (
        <button
          onClick={onCerrar}
          aria-label="Cerrar"
          style={{ position: 'absolute', top: 10, right: 10, border: 'none', background: 'transparent',
                   cursor: 'pointer', fontSize: 18, lineHeight: 1, color: 'var(--text-mute)' }}
        >✕</button>
      )}
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{emoji('')}WhatsApp desconectado — escanea el QR para vincular</div>
      <div style={{ opacity: 0.7, fontSize: 13, marginBottom: 16 }}>
        Se actualiza solo cada {Math.round(QR_POLL_MS / 1000)}s mientras no se escanee. Si el teléfono pierde la
        vinculación más adelante, este QR vuelve a aparecer automáticamente.
      </div>
      <canvas ref={canvasRef} />
      <div style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 10 }}>
        Esta ventana se cierra sola en cuanto el teléfono quede vinculado.
      </div>
    </div>
  );

  // En pantalla completa (compuerta pre-login) va tal cual; dentro del panel
  // es una VENTANA modal que se cierra sola al loguear el teléfono.
  if (pantallaCompleta) return tarjeta;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', background: 'rgba(10,12,18,0.55)' }}>
      {tarjeta}
    </div>
  );
}
