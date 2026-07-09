import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { QR_POLL_MS } from '../hooks/useWhatsAppQR';
import { useEmoji } from '../context/EmojiContext';

// Dibuja el QR de vinculación de WhatsApp. Lo usan tanto la compuerta de
// App.jsx (antes de loguearse al dashboard) como el aviso de Inicio.jsx (si
// WhatsApp se desvincula más tarde, con la sesión del dashboard ya abierta) —
// un solo lugar para el canvas en vez de duplicar QRCode.toCanvas dos veces.
export default function WhatsAppQR({ qr, pantallaCompleta = false }) {
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
        marginBottom: pantallaCompleta ? 0 : 0,
        padding: 24,
        textAlign: 'center',
        borderColor: 'var(--accent)',
        maxWidth: 380,
        background: 'var(--panel)',
      }}
    >
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
