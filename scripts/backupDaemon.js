'use strict';
// backupDaemon — proceso pm2 para Docker: mantiene vivo el scheduler de
// respaldos (11:00 DB / 11:30 imágenes). backup.js corrido DIRECTO ejecuta una
// vez y sale (modo cron/manual); REQUERIDO como módulo agenda y se queda vivo
// por sus timers — eso es exactamente lo que un contenedor necesita (no hay
// Task Scheduler/cron dentro). Ver ecosystem.docker.config.js.
require('dotenv').config({ quiet: true });
require('./backup.js');   // rama "else" → agendarBackup() + timers mantienen vivo
console.log('[backupDaemon] scheduler de respaldos activo (pm2/Docker)');
