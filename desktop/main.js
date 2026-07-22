// Ventana de escritorio que envuelve el dashboard (http://localhost:3001)
// en vez de abrir el navegador default de la máquina. El bot y el
// dashboard corren aparte vía PM2 (ecosystem.config.js, ya lanzado por
// start.bat antes de esto) — cerrar esta ventana NO los apaga por
// default; hay que elegirlo explícitamente en el diálogo de cierre.
'use strict';
const { app, BrowserWindow, dialog } = require('electron');
const { execFile } = require('child_process');

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3001';
const PM2_BIN = process.platform === 'win32' ? 'pm2.cmd' : 'pm2';

// Nombre interno de la app (carpeta de userData, Task Manager, etc.) — el
// titulo de la ventana sigue siendo la marca del negocio, esto es solo el
// identificador del proceso/app de escritorio en si.
app.setName('botdashapp');

// Mismo arreglo que dashboard/server.js: cmd.exe /c necesita el comando
// envuelto en un par extra de comillas para no tomar las comillas internas
// como parte literal del nombre del programa, y windowsVerbatimArguments
// evita que Node vuelva a escapar esa cadena ya armada.
function pm2(args, cb) {
    if (process.platform === 'win32') {
        const inner = [PM2_BIN, ...args].map(arg => `"${String(arg).replace(/"/g, '\\"')}"`).join(' ');
        const command = `"${inner}"`;
        execFile('cmd.exe', ['/d', '/s', '/c', command], { timeout: 15000, windowsHide: true, windowsVerbatimArguments: true }, (err, stdout, stderr) => cb(err, stdout, stderr));
        return;
    }
    execFile(PM2_BIN, args, { timeout: 15000, windowsHide: true }, cb);
}

let win;
let confirmado = false;

function crearVentana() {
    win = new BrowserWindow({
        width: 1320,
        height: 840,
        title: 'Julio Cepeda — Panel',
        webPreferences: { contextIsolation: true, nodeIntegration: false },
    });

    let intentos = 0;
    const cargar = () => {
        if (!win || win.isDestroyed()) return; // la ventana se cerró mientras el retry estaba pendiente
        win.loadURL(DASHBOARD_URL).catch(() => {});
    };
    win.webContents.on('did-fail-load', () => {
        if (intentos++ < 20) setTimeout(cargar, 1000); // el dashboard puede tardar unos segundos en levantar
    });
    cargar();

    win.on('close', (e) => {
        if (confirmado) return;
        e.preventDefault();
        const resp = dialog.showMessageBoxSync(win, {
            type: 'question',
            buttons: ['Cancelar', 'Solo cerrar ventana', 'Apagar todo'],
            defaultId: 1,
            cancelId: 0,
            title: 'Cerrar Julio Cepeda — Panel',
            message: '¿Qué quieres hacer?',
            detail: 'El bot y el dashboard siguen corriendo en segundo plano (PM2) aunque cierres esta ventana.\n\nElige "Apagar todo" solo si quieres detener el bot por completo.',
        });
        if (resp === 0) return; // cancelar: no hacer nada
        confirmado = true;
        if (resp === 2) {
            pm2(['stop', 'all'], () => app.quit());
        } else {
            app.quit();
        }
    });
}

app.whenReady().then(crearVentana);
app.on('window-all-closed', () => app.quit());
