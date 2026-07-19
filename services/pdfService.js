'use strict';
// pdfService — genera un PDF (Buffer) a partir de HTML usando el Chromium que ya
// trae el contenedor (puppeteer-core, mismo binario que el bot). Cero dependencia
// nueva de PDF. Uso: adjuntar cotizaciones/facturas/reportes por correo — hoy esos
// documentos solo se imprimían desde el navegador (window.print). On-demand.
const puppeteer = require('puppeteer-core');

function _chromePath() {
    const cand = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
    for (const p of cand) { try { if (p && require('fs').existsSync(p)) return p; } catch (_) {} }
    return process.env.CHROME_PATH || '/usr/bin/chromium';
}

// html → Buffer PDF. Lanza si Chrome no está disponible (el caller lo maneja).
async function htmlAPdf(html, { formato = 'A4', margen = '12mm' } = {}) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true, executablePath: _chromePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote'],
        });
        const page = await browser.newPage();
        // Re-auditoría H10: el HTML viene del body del request — sin esto, un
        // <img src="http://interno/..."> renderizaría servicios internos de la
        // red al PDF (SSRF). Solo se permiten recursos embebidos (data:/blob:).
        await page.setRequestInterception(true);
        page.on('request', req => {
            const u = req.url();
            if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:')) return req.continue();
            return req.abort();
        });
        await page.setContent(String(html || ''), { waitUntil: 'networkidle0', timeout: 20000 });
        const pdf = await page.pdf({ format: formato, printBackground: true, margin: { top: margen, bottom: margen, left: margen, right: margen } });
        return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    } finally {
        if (browser) { try { await browser.close(); } catch (_) {} }
    }
}

function disponible() {
    try { return require('fs').existsSync(_chromePath()); } catch (_) { return false; }
}

module.exports = { htmlAPdf, disponible };
