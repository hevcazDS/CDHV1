module.exports = {
  apps: [
    {
      name: 'bot-whatsapp',
      script: './bot/index.js',
      cwd: __dirname,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 5000,
      max_restarts: 5,
      min_uptime: '15s',
      env: {
        NODE_ENV: 'production'
      },
      log_file: './logs/bot.log',
      error_file: './logs/bot-error.log',
      time: true
    },
    {
      name: 'dashboard',
      script: './dashboard/server.js',
      cwd: __dirname,
      watch: false,
      max_memory_restart: '256M',
      restart_delay: 3000,
      max_restarts: 5,
      min_uptime: '15s',
      env: {
        NODE_ENV: 'production'
      },
      log_file: './logs/dashboard.log',
      error_file: './logs/dashboard-error.log',
      time: true
    }
  ]
};