// .puppeteerrc.cjs — leído por puppeteer (vía cosmiconfig) al instalarse.
// whatsapp-web.js trae el paquete completo "puppeteer" como dependencia
// transitiva, que por defecto descarga su propio Chrome (~300MB). El bot
// usa Chrome/Chromium del sistema vía CHROME_PATH (bot/index.js), así que
// esa descarga nunca se usa — solo agrega un punto de falla al instalar
// (red lenta, sandbox sin internet, etc). Esta es la forma oficial de
// desactivarla (más confiable que la variable de entorno PUPPETEER_SKIP_DOWNLOAD
// o la clave puppeteer_skip_download en .npmrc, que npm ya no garantiza pasar).
module.exports = {
    skipDownload: true,
};
