// fontPrefs.js — selector de fuente/tamaño pedido por el operador (la fuente
// por default se salía de las burbujas de chat en pantallas chicas). No hay
// endpoint de servidor para esto -- es preferencia de navegador, igual que
// el tema (ThemeSwitcher.jsx), persistida en localStorage.
//
// Las 3 familias son self-hosteadas via @fontsource (ver imports en
// main.jsx) -- nunca Google Fonts CDN, para no abrir la CSP (default-src
// 'self'). Cambiar --mantine-font-family/-headings cubre los componentes
// Mantine; fijar font-family directo en <html> cubre las páginas legadas
// (20 páginas que todavía usan CSS plano, no Mantine, para su estilo).
const KEY_FAMILIA = 'jc-fuente-familia';
const KEY_TAMANO  = 'jc-fuente-tamano';

const FAMILIAS = {
    inter:      '"Inter", -apple-system, "Segoe UI", system-ui, Roboto, sans-serif',
    ibmplex:    '"IBM Plex Sans", -apple-system, "Segoe UI", system-ui, Roboto, sans-serif',
    sourcesans: '"Source Sans 3", -apple-system, "Segoe UI", system-ui, Roboto, sans-serif',
};

const TAMANOS = { pequeno: '13px', normal: '15px', grande: '17px' };

function aplicarPreferenciasFuente(familia, tamano) {
    const fam = FAMILIAS[familia] || FAMILIAS.inter;
    const root = document.documentElement;
    root.style.setProperty('--mantine-font-family', fam);
    root.style.setProperty('--mantine-font-family-headings', fam);
    root.style.fontFamily = fam;
    root.style.fontSize = TAMANOS[tamano] || TAMANOS.normal;
}

function cargarPreferenciasFuente() {
    const familia = localStorage.getItem(KEY_FAMILIA) || 'inter';
    const tamano  = localStorage.getItem(KEY_TAMANO) || 'normal';
    aplicarPreferenciasFuente(familia, tamano);
    return { familia, tamano };
}

function guardarPreferenciasFuente(familia, tamano) {
    localStorage.setItem(KEY_FAMILIA, familia);
    localStorage.setItem(KEY_TAMANO, tamano);
    aplicarPreferenciasFuente(familia, tamano);
}

export { FAMILIAS, TAMANOS, cargarPreferenciasFuente, guardarPreferenciasFuente };
