# scripts/bot-control.ps1 — control independiente del bot (start/stop/restart).
# A propósito vive fuera del dashboard: que el propio proceso del dashboard
# fuera el que dispara pm2 sobre el bot daba la sensación de un reinicio en
# cascada ("reinicias el bot y se reinicia el dash") y dependía de que el
# dashboard estuviera sano para poder apagar el bot. Esto corre en su propio
# proceso powershell.exe, a mano o desde el Programador de tareas de Windows.
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('start', 'stop', 'restart')]
    [string]$Accion
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

# Mismo escapado que bot/index.js (escaparParaPsLike): [ ] necesitan backtick
# porque -like los trata como clase de caracteres, no como texto literal —
# sin esto una ruta con corchetes nunca matchearía nada.
function Escapar-ParaPsLike([string]$Ruta) {
    return ($Ruta -replace "'", "''") -replace '([[\]])', '`$1'
}

# Solo CIERRA las ventanas de Electron que ya existan — bot/index.js ya
# llama a abrirDashboard() de forma incondicional en cada arranque (línea
# `abrirDashboard();` justo después de construir el client, no detrás de
# ningún evento de WhatsApp) y esa función ya sabe relanzar Electron sola si
# no encuentra una ventana abierta. Si este script TAMBIÉN la relanzara,
# ambos terminan abriendo una ventana cada uno casi al mismo tiempo —
# duplicado, confirmado al probarlo. Cerrar aquí y dejar que el bot reabra
# es lo único que evita esa carrera.
function Cerrar-Electron {
    $desktopDir = Escapar-ParaPsLike (Join-Path $raiz 'desktop')
    $existentes = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
        Where-Object { $_.CommandLine -like "*$desktopDir*" }
    if ($existentes) {
        Write-Host 'Cerrando ventana de Electron existente...'
        $existentes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 2
    }
}

switch ($Accion) {
    'start' {
        Write-Host 'Encendiendo bot-whatsapp...'
        & pm2 start ecosystem.config.js --only bot-whatsapp
    }
    'stop' {
        Write-Host 'Apagando bot-whatsapp...'
        & pm2 stop bot-whatsapp
    }
    'restart' {
        Cerrar-Electron
        Write-Host 'Reiniciando bot-whatsapp...'
        & pm2 restart bot-whatsapp
        Write-Host 'El bot reabrirá Electron solo en su arranque.'
    }
}
