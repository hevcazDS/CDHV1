// ecosystem.docker.config.js — pm2 para el CONTENEDOR: los dos procesos de
// siempre (ecosystem.config.js, sin duplicar su config) + el daemon de
// respaldos. En Windows/local los respaldos los agenda el operador (Task
// Scheduler / manual) — por eso el daemon NO va en el ecosystem base: aquí
// dentro no hay cron y sin esto el contenedor jamás respaldaría.
const base = require('./ecosystem.config.js');

module.exports = {
    apps: [
        ...base.apps,
        {
            name: 'backup',
            script: './scripts/backupDaemon.js',
            cwd: __dirname,
            watch: false,
            max_memory_restart: '128M',
            restart_delay: 60000,   // si crashea, reintenta al minuto (no spamea correos)
            max_restarts: 10,
            min_uptime: '30s',
            env: { NODE_ENV: 'production' },
            log_file: './logs/backup.log',
            error_file: './logs/backup-error.log',
            time: true,
        },
    ],
};
