# instalador-windows-chatbot.ps1 — revisa qué ya está instalado y solo
# reinstala lo que falta o está roto. No descarga nada de fuentes externas
# salvo lo que tú ya confirmes (Node/Chrome), y no toca nada fuera de esta
# carpeta del proyecto salvo cuando instalas pm2 global a propósito.
#
# Texto plano, sin empaquetar a .exe (pkg/nexe/etc. son justo los que el
# antivirus marca como falso positivo por el empaquetado) — un script de
# PowerShell ejecutado a la vista, sin -WindowStyle Hidden ni -EncodedCommand,
# es invisible para esos heurísticos.
#
# -EnvPath: para uso no interactivo, ej.
#   instalador-windows-chatbot.ps1 -EnvPath "D:\backup\.env"
param(
    [string]$EnvPath
)

$ErrorActionPreference = 'Stop'
function Step($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "    OK: $msg" -ForegroundColor Green }
function Warn2($msg) { Write-Host "    AVISO: $msg" -ForegroundColor Yellow }
function Err2($msg)  { Write-Host "    ERROR: $msg" -ForegroundColor Red }

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  Instalador Windows - Chatbot Julio Cepeda" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# ── 1) Node.js ────────────────────────────────────────────────────────
Step "Verificando Node.js (se requiere 20.x)"
try {
    $nodeVerRaw = (node --version).Trim() -replace '^v',''
    $nodeMajor = [int]($nodeVerRaw.Split('.')[0])
    if ($nodeMajor -eq 20) {
        Ok "Node.js v$nodeVerRaw"
    } else {
        Warn2 "Node.js v$nodeVerRaw instalado, pero el proyecto fue probado en 20.x."
        Warn2 "Puede que algunas dependencias nativas (better-sqlite3) se compilen distinto."
        Warn2 "Descarga Node 20 LTS: https://nodejs.org/en/download (si quieres igualar la version probada)"
    }
} catch {
    Err2 "Node.js no encontrado. Instala Node 20 LTS desde https://nodejs.org/en/download y vuelve a correr este instalador."
    Read-Host "Presiona Enter para cerrar"
    exit 1
}

# ── 2) npm ────────────────────────────────────────────────────────────
Step "Verificando npm"
try {
    $npmVer = (npm --version).Trim()
    Ok "npm v$npmVer"
} catch {
    Err2 "npm no encontrado (deberia venir junto con Node.js)."
    Read-Host "Presiona Enter para cerrar"
    exit 1
}

# ── 3) Chrome / Chromium (para CHROME_PATH) ─────────────────────────────
Step "Verificando Chrome/Chromium"
$chromeDefault = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$chromePath = $null
if (Test-Path $chromeDefault) {
    $chromePath = $chromeDefault
    Ok "Chrome encontrado: $chromeDefault"
} else {
    $chromeCmd = Get-Command chrome.exe -ErrorAction SilentlyContinue
    if ($chromeCmd) {
        $chromePath = $chromeCmd.Source
        Ok "Chrome encontrado en PATH: $chromePath"
    } else {
        Warn2 "No se encontro Chrome instalado. El bot no podra arrancar sin CHROME_PATH en .env."
        Warn2 "Instala Google Chrome o define CHROME_PATH manualmente despues."
    }
}

# ── 4) pm2 (gestor de procesos, ya usado por package.json) ─────────────
Step "Verificando pm2"
$pm2Ok = $false
try {
    $pm2Ver = (pm2 --version).Trim()
    Ok "pm2 v$pm2Ver"
    $pm2Ok = $true
} catch {
    Warn2 "pm2 no esta instalado globalmente (se usa para encender/apagar el bot)."
    $resp = Read-Host "    Instalar pm2 ahora con 'npm install -g pm2'? (s/n)"
    if ($resp -eq 's') {
        npm install -g pm2
        $pm2Ok = $true
    }
}

# ── 5) Estado de node_modules: ¿falta, esta roto, o esta bien? ─────────
Step "Revisando node_modules"
$needsFresh = $false
if (-not (Test-Path "node_modules")) {
    Warn2 "node_modules no existe todavia."
    $needsFresh = $true
} else {
    $testResult = node -e "try { require('better-sqlite3'); console.log('LIBOK') } catch(e) { console.log('FALLA') }" 2>&1
    if ($testResult -notmatch 'LIBOK') {
        Warn2 "better-sqlite3 no carga (node_modules corrupto o de otra version de Node/Windows)."
        $needsFresh = $true
    } else {
        Ok "node_modules presente y el modulo nativo carga bien."
    }
}

if ($needsFresh -and (Test-Path "node_modules")) {
    Step "Borrando node_modules para reinstalar desde cero"
    Remove-Item -Recurse -Force "node_modules"
}

# ── 6) Instalar dependencias — siempre exacto al lockfile ──────────────
Step "Instalando dependencias (npm ci)"
npm ci
if ($LASTEXITCODE -ne 0) {
    Err2 "npm ci fallo. Revisa el mensaje de arriba (faltan Python/compilador para compilar algun modulo nativo?)."
    Read-Host "Presiona Enter para cerrar"
    exit 1
}
Ok "Dependencias instaladas."

# ── 6b) Panel en React (dashboard-ui) — instalar y compilar a dist/ ────
Step "Instalando y compilando el panel (dashboard-ui)"
Push-Location "dashboard-ui"
npm install
if ($LASTEXITCODE -ne 0) {
    Warn2 "npm install en dashboard-ui fallo. El dashboard caera al HTML clasico (dashboard.html)."
} else {
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Warn2 "El build de dashboard-ui fallo. El dashboard caera al HTML clasico (dashboard.html)."
    } else {
        Ok "Panel en React compilado (dashboard-ui/dist)."
    }
}
Pop-Location

# ── 6c) Ventana de escritorio (desktop, Electron) — solo instalar deps ──
Step "Instalando la ventana de escritorio (desktop)"
Push-Location "desktop"
npm install
if ($LASTEXITCODE -ne 0) {
    Warn2 "npm install en desktop fallo. start.bat no podra abrir la ventana de escritorio."
} else {
    Ok "Ventana de escritorio lista."
}
Pop-Location

# ── 7) .env — usar uno ya hecho (de la maquina donde correra) si hay uno ─
Step "Configurando .env"

function Copiar-EnvDesde($origen) {
    if (-not (Test-Path $origen)) {
        Err2 "No se encontro ese archivo: $origen"
        return $false
    }
    Copy-Item $origen ".env" -Force
    Ok ".env copiado desde: $origen"
    return $true
}

function Pedir-Valor($prompt, $default) {
    $sufijo = if ($default) { " [$default]" } else { "" }
    $valor = Read-Host "    $prompt$sufijo"
    if ([string]::IsNullOrWhiteSpace($valor)) { return $default } else { return $valor }
}

function Set-EnvVar($clave, $valor) {
    $linea = "$clave=$valor"
    if ((Test-Path ".env") -and (Get-Content ".env" -Raw) -match "(?m)^$clave=.*$") {
        (Get-Content ".env") -replace "(?m)^$clave=.*$", $linea | Set-Content ".env"
    } else {
        Add-Content ".env" $linea
    }
}

$envListo = $false
$nombreNegocio = ""
$tonoBot = "C"

if ($EnvPath) {
    # Modo no interactivo: ya nos dijeron de donde sacarlo (-EnvPath)
    $envListo = Copiar-EnvDesde $EnvPath
} elseif (Test-Path ".env") {
    Ok ".env ya existe en esta carpeta."
    $resp = Read-Host "    Usar el .env existente (U), apuntar a OTRO archivo .env (O), o crear uno nuevo guiado (N)? [U]"
    switch ($resp.ToUpper()) {
        "O" { $origen = Read-Host "    Ruta completa al archivo .env a usar"; $envListo = Copiar-EnvDesde $origen }
        "N" { $envListo = $false }  # cae al bloque guiado de abajo
        default { $envListo = $true }
    }
} else {
    $resp = Read-Host "    Ya tienes un .env de donde se va a correr este bot (otra maquina, USB, backup)? (s/n)"
    if ($resp -eq 's') {
        $origen = Read-Host "    Ruta completa al archivo .env a usar"
        $envListo = Copiar-EnvDesde $origen
    }
}

if (-not $envListo) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env" -Force
        Step "Llenando .env paso a paso (Enter para dejar el valor entre [])"
        $nombreNegocio = Pedir-Valor "Nombre del negocio (para personalizar al bot)" ""
        $tonoBot = Pedir-Valor "Tono del bot: A=formal, B=casual, C=amigable, D=ventas/urgencia" "C"
        Set-EnvVar "DASHBOARD_USER" (Pedir-Valor "Usuario admin del dashboard" "admin")
        $passNuevo = Pedir-Valor "Password del usuario admin del dashboard" ""
        if ($passNuevo) { Set-EnvVar "DASHBOARD_PASS" $passNuevo }
        $primeNuevo = Pedir-Valor "Usuario 'prime' (inventario/sucursales) -- vacio si no se usa todavia" ""
        if ($primeNuevo) {
            Set-EnvVar "USER_PRIME" $primeNuevo
            Set-EnvVar "USER_PRIME_PASSWORD" (Pedir-Valor "Password del usuario prime" "")
        }
        if ($chromePath) { Set-EnvVar "CHROME_PATH" (Pedir-Valor "Ruta a chrome.exe/chromium" $chromePath) }
        Set-EnvVar "ASESOR_WHATSAPP" (Pedir-Valor "WhatsApp del asesor humano (con codigo de pais, ej. 521...)" "")
        Set-EnvVar "FLETE_UMBRAL" (Pedir-Valor "Monto minimo de compra para envio gratis" "699")
        Ok ".env creado paso a paso."
        $envListo = $true
    } else {
        Warn2 "No existe .env ni .env.example. Crea .env manualmente con las variables que necesita el bot."
    }
}

# Si trajimos un .env ya configurado, avisar de claves criticas vacias o default
if ($envListo -and (Test-Path ".env")) {
    $envLines = Get-Content ".env"
    foreach ($clave in @('DASHBOARD_PASS','ASESOR_WHATSAPP')) {
        $linea = $envLines | Where-Object { $_ -match "^$clave=" } | Select-Object -First 1
        if (-not $linea -or $linea -match "^$clave=\s*$" -or $linea -match "^$clave=cambiar_esto\s*$") {
            Warn2 "$clave esta vacio o con el valor de ejemplo en .env -- revisalo antes de arrancar."
        }
    }
}

if ($chromePath -and (Test-Path ".env")) {
    $envContent = Get-Content ".env" -Raw
    if ($envContent -notmatch 'CHROME_PATH=.+') {
        Set-EnvVar "CHROME_PATH" $chromePath
        Ok "CHROME_PATH agregado a .env automaticamente."
    }
}

# ── 8) Base de datos ────────────────────────────────────────────────────
Step "Configurando la base de datos"
$dbPathActual = $null
if ((Get-Content ".env" -Raw) -match '(?m)^DB_PATH=(.*)$') {
    $dbPathActual = $Matches[1].Trim()
}
if ($dbPathActual -and (Test-Path $dbPathActual)) {
    Ok "DB_PATH ya apunta a un archivo existente: $dbPathActual -- se verifica que tenga todo lo necesario."
    node scripts/instalarBaseDeDatos.js verificar-y-completar $dbPathActual
} else {
    $modoDb = Read-Host "    Crear una base de datos NUEVA (N) o ya tienes una y solo hay que apuntarla/completarla (E)? [N]"
    if ($modoDb.ToUpper() -eq "E") {
        $rutaDb = Read-Host "    Ruta completa al archivo .db existente"
        $salidaDb = node scripts/instalarBaseDeDatos.js verificar-y-completar $rutaDb
    } else {
        $rutaDb = Pedir-Valor "Ruta donde crear la base de datos nueva" (Join-Path $repoRoot "db\jugueteria.db")
        # node toma argumentos vacíos como string ("") de forma inconsistente
        # al ejecutarse como comando nativo desde PowerShell, así que el
        # arreglo de argumentos solo incluye nombre/tono si de verdad se llenaron.
        $argsDb = @('crear-nueva', $rutaDb)
        if ($nombreNegocio) {
            $argsDb += $nombreNegocio
            if ($tonoBot) { $argsDb += $tonoBot }
        }
        $salidaDb = node scripts/instalarBaseDeDatos.js @argsDb
    }
    $lineaDbPath = $salidaDb | Where-Object { $_ -match '^DB_PATH=' } | Select-Object -Last 1
    if ($lineaDbPath) {
        $dbPathResultante = $lineaDbPath -replace '^DB_PATH=', ''
        Set-EnvVar "DB_PATH" $dbPathResultante
        Ok "DB_PATH escrito en .env: $dbPathResultante"
    } else {
        Err2 "No se pudo determinar la ruta de la base de datos -- revisa el mensaje de arriba y define DB_PATH manualmente en .env."
    }
}

Write-Host "`n=================================================" -ForegroundColor Green
Write-Host "  Listo." -ForegroundColor Green
Write-Host "  Revisa .env y luego corre start.bat (o npm run start:all)." -ForegroundColor Green
if (-not $pm2Ok) { Write-Host "  (pm2 no quedo instalado - instalalo antes de start:all)" -ForegroundColor Yellow }
Write-Host "=================================================" -ForegroundColor Green
if (-not $EnvPath) { Read-Host "Presiona Enter para cerrar" }
