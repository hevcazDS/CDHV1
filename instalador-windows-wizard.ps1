# instalador-windows-wizard.ps1 — versión con interfaz gráfica (asistente
# paso a paso) de instalador-windows-chatbot.ps1. Mismo trabajo real por
# debajo (mismos comandos: npm ci, scripts/instalarBaseDeDatos.js,
# scripts/migrate.js, etc.) — lo único que cambia es la forma de mostrarlo:
# una pantalla por paso, con lo que va a pasar explicado ANTES de hacerlo,
# el resultado real después, y los puntos de decisión (.env, base de datos)
# como formularios con opciones en vez de tener que escribir una letra a
# mano en una consola.
#
# instalador-windows-chatbot.ps1 sigue existiendo tal cual (modo consola,
# soporta -EnvPath para uso no interactivo/automatizado) — este wizard es
# la versión amigable para correr una sola vez a mano, no lo reemplaza.
#
# Texto plano interpretado por powershell.exe, igual que el otro instalador
# (ver su cabecera): nada se empaqueta a .exe, por la misma razón de
# falsos positivos de antivirus con binarios compilados.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $script:RepoRoot

# ───────────────────────── Estado compartido entre pasos ───────────────────
$script:S = @{
    ChromePath     = $null
    Pm2Ok          = $false
    NombreNegocio  = ''
    TonoBot        = 'C'
    DbOk           = $false
}

# ───────────────────────── Helpers de proceso ───────────────────────────────
# npm/npx/pm2 son shims .cmd en Windows -- Process.Start con UseShellExecute
# = $false no puede ejecutar un .cmd directamente (no es un binario PE), así
# que se envuelven con cmd.exe /c. node.exe sí es un binario real y se
# ejecuta directo, sin envoltura. Los argumentos van siempre en ArgumentList
# (uno por elemento, nunca concatenados a mano en un solo string), así que
# nada de lo que pasamos -- rutas, nombres -- se vuelve a interpretar como
# texto de shell.
function Invoke-Logged {
    param(
        [string]$Exe,
        [string[]]$ArgsList = @(),
        [string]$WorkDir = $script:RepoRoot
    )
    $needsCmd = $Exe -in @('npm', 'npx', 'pm2')
    if ($needsCmd) {
        $fileName = $env:ComSpec
        $finalArgs = @('/c', $Exe) + $ArgsList
    } else {
        $resolved = Get-Command $Exe -ErrorAction SilentlyContinue
        $fileName = if ($resolved) { $resolved.Source } else { $Exe }
        $finalArgs = $ArgsList
    }
    Append-Log "> $Exe $($ArgsList -join ' ')"
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $fileName
    foreach ($a in $finalArgs) { [void]$psi.ArgumentList.Add($a) }
    $psi.WorkingDirectory = $WorkDir
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    try {
        $proc = [System.Diagnostics.Process]::Start($psi)
    } catch {
        Append-Log "  (no se pudo ejecutar: $($_.Exception.Message))"
        return @{ ExitCode = 1; StdOut = '' }
    }
    $stdoutLines = New-Object System.Collections.Generic.List[string]
    $drenar = {
        while ($proc.StandardOutput.Peek() -ge 0) {
            $l = $proc.StandardOutput.ReadLine()
            $stdoutLines.Add($l)
            Append-Log $l
        }
        while ($proc.StandardError.Peek() -ge 0) {
            Append-Log $proc.StandardError.ReadLine()
        }
    }
    while (-not $proc.HasExited) {
        & $drenar
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 40
    }
    & $drenar
    return @{ ExitCode = $proc.ExitCode; StdOut = ($stdoutLines -join "`n") }
}

function Append-Log([string]$texto) {
    if ($null -eq $texto) { return }
    $script:LogBox.AppendText($texto + [Environment]::NewLine)
    $script:LogBox.SelectionStart = $script:LogBox.TextLength
    $script:LogBox.ScrollToCaret()
    [System.Windows.Forms.Application]::DoEvents()
}

# ───────────────────────── Formulario genérico de decisión ──────────────────
# Un único renderizador de formularios para todos los puntos de decisión
# (.env, base de datos): cada "campo" es Texto / Password / Ruta (con botón
# Buscar...) / Opción (radio buttons). Devuelve un hashtable Clave->Valor, o
# $null si el usuario cancela -- así cada punto de decisión cancelado se
# trata como "se omite este sub-paso", nunca como crash del asistente.
function Show-WizardForm {
    param(
        [string]$Titulo,
        [string]$Intro,
        [array]$Campos
    )
    $form = New-Object System.Windows.Forms.Form
    $form.Text = $Titulo
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.Width = 600
    $font = New-Object System.Drawing.Font('Segoe UI', 9)
    $form.Font = $font

    $y = 16
    if ($Intro) {
        $lblIntro = New-Object System.Windows.Forms.Label
        $lblIntro.Text = $Intro
        $lblIntro.SetBounds(16, $y, 550, 40)
        $form.Controls.Add($lblIntro)
        $y += 48
    }

    $controles = @{}
    foreach ($f in $Campos) {
        $lbl = New-Object System.Windows.Forms.Label
        $lbl.Text = $f.Label
        $lbl.SetBounds(16, $y, 550, 18)
        $form.Controls.Add($lbl)
        $y += 20

        if ($f.Type -eq 'Choice') {
            $grupo = @()
            foreach ($opt in $f.Choices) {
                $rb = New-Object System.Windows.Forms.RadioButton
                $rb.Text = $opt.Label
                $rb.Tag = $opt.Key
                $rb.SetBounds(32, $y, 534, 20)
                $rb.Checked = ($opt.Key -eq $f.Default)
                $form.Controls.Add($rb)
                $grupo += $rb
                $y += 22
            }
            $controles[$f.Key] = $grupo
        } else {
            $tb = New-Object System.Windows.Forms.TextBox
            $anchoTexto = if ($f.Type -eq 'Path') { 460 } else { 550 }
            $tb.SetBounds(16, $y, $anchoTexto, 22)
            $tb.Text = [string]$f.Default
            if ($f.Type -eq 'Password') { $tb.UseSystemPasswordChar = $true }
            $form.Controls.Add($tb)
            $controles[$f.Key] = $tb

            if ($f.Type -eq 'Path') {
                $btnBuscar = New-Object System.Windows.Forms.Button
                $btnBuscar.Text = 'Buscar...'
                $btnBuscar.SetBounds(482, $y, 84, 22)
                $modo = $f.PathMode
                $tbRef = $tb
                $btnBuscar.Add_Click({
                    if ($modo -eq 'Save') {
                        $dlg = New-Object System.Windows.Forms.SaveFileDialog
                        $dlg.OverwritePrompt = $false
                    } else {
                        $dlg = New-Object System.Windows.Forms.OpenFileDialog
                    }
                    $dlg.Filter = 'Base de datos SQLite (*.db)|*.db|Todos los archivos (*.*)|*.*'
                    if (Test-Path $tbRef.Text) { $dlg.InitialDirectory = Split-Path $tbRef.Text }
                    if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
                        $tbRef.Text = $dlg.FileName
                    }
                }.GetNewClosure())
                $form.Controls.Add($btnBuscar)
            }
            $y += 26
        }
        $y += 6
    }

    $btnOk = New-Object System.Windows.Forms.Button
    $btnOk.Text = 'Continuar'
    $btnOk.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $btnOk.SetBounds(394, $y + 8, 90, 30)
    $form.Controls.Add($btnOk)

    $btnCancel = New-Object System.Windows.Forms.Button
    $btnCancel.Text = 'Cancelar'
    $btnCancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $btnCancel.SetBounds(490, $y + 8, 90, 30)
    $form.Controls.Add($btnCancel)

    $form.AcceptButton = $btnOk
    $form.CancelButton = $btnCancel
    $form.Height = $y + 100

    $resultado = $form.ShowDialog()
    if ($resultado -ne [System.Windows.Forms.DialogResult]::OK) { return $null }

    $valores = @{}
    foreach ($k in $controles.Keys) {
        $c = $controles[$k]
        if ($c -is [array]) {
            $marcado = $c | Where-Object { $_.Checked } | Select-Object -First 1
            $valores[$k] = if ($marcado) { $marcado.Tag } else { $null }
        } else {
            $valores[$k] = $c.Text
        }
    }
    return $valores
}

# ───────────────────────── Helpers de .env (idénticos al instalador de consola) ─
function Set-EnvVar($clave, $valor) {
    $linea = "$clave=$valor"
    if ((Test-Path '.env') -and ((Get-Content '.env' -Raw) -match "(?m)^$clave=.*$")) {
        (Get-Content '.env') -replace "(?m)^$clave=.*$", $linea | Set-Content '.env'
    } else {
        Add-Content '.env' $linea
    }
}

# ───────────────────────── Definición de cada paso ───────────────────────────
# Cada paso es: Name (lo que se ve en la lista), Desc (qué hace, mostrado
# ANTES de ejecutarlo), Critical (si falla con ERROR, ya no tiene sentido
# seguir -- igual que el instalador de consola, que en esos casos hace
# exit 1), y Action (el trabajo real). Action devuelve @{Status; Message}.

function Step-Node {
    $r = Invoke-Logged -Exe 'node' -ArgsList @('--version')
    if ($r.ExitCode -ne 0 -or -not $r.StdOut) {
        return @{ Status = 'ERROR'; Message = 'Node.js no encontrado. Instala Node 20 LTS desde https://nodejs.org/en/download y vuelve a abrir este asistente.' }
    }
    $verRaw = $r.StdOut.Trim() -replace '^v', ''
    $major = [int]($verRaw.Split('.')[0])
    if ($major -eq 20) {
        return @{ Status = 'OK'; Message = "Node.js v$verRaw" }
    }
    return @{ Status = 'WARN'; Message = "Node.js v$verRaw instalado, pero el proyecto fue probado en 20.x. Algunas dependencias nativas (better-sqlite3) podrían compilarse distinto." }
}

function Step-Npm {
    $r = Invoke-Logged -Exe 'npm' -ArgsList @('--version')
    if ($r.ExitCode -ne 0 -or -not $r.StdOut) {
        return @{ Status = 'ERROR'; Message = 'npm no encontrado (debería venir junto con Node.js).' }
    }
    return @{ Status = 'OK'; Message = "npm v$($r.StdOut.Trim())" }
}

function Step-Chrome {
    $chromeDefault = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
    if (Test-Path $chromeDefault) {
        $script:S.ChromePath = $chromeDefault
        return @{ Status = 'OK'; Message = "Chrome encontrado: $chromeDefault" }
    }
    $cmd = Get-Command chrome.exe -ErrorAction SilentlyContinue
    if ($cmd) {
        $script:S.ChromePath = $cmd.Source
        return @{ Status = 'OK'; Message = "Chrome encontrado en PATH: $($cmd.Source)" }
    }
    $form = Show-WizardForm -Titulo 'Chrome no encontrado' `
        -Intro 'No se encontró Chrome instalado en la ruta default ni en PATH. El bot no podrá arrancar sin CHROME_PATH en .env. Si lo tienes instalado en otro lado, indícalo aquí (o déjalo vacío y corrígelo después en .env).' `
        -Campos @(
            @{ Key = 'Ruta'; Label = 'Ruta a chrome.exe / chromium (opcional)'; Type = 'Path'; PathMode = 'Open'; Default = '' }
        )
    if ($form -and $form.Ruta) {
        $script:S.ChromePath = $form.Ruta
        return @{ Status = 'OK'; Message = "CHROME_PATH establecido manualmente: $($form.Ruta)" }
    }
    return @{ Status = 'WARN'; Message = 'No se encontró Chrome. Define CHROME_PATH manualmente en .env antes de arrancar el bot.' }
}

function Step-Pm2 {
    $r = Invoke-Logged -Exe 'pm2' -ArgsList @('--version')
    if ($r.ExitCode -eq 0 -and $r.StdOut) {
        $script:S.Pm2Ok = $true
        return @{ Status = 'OK'; Message = "pm2 v$($r.StdOut.Trim())" }
    }
    $resp = [System.Windows.Forms.MessageBox]::Show(
        "pm2 no está instalado globalmente (se usa para encender/apagar el bot).`n`n¿Instalarlo ahora con 'npm install -g pm2'?",
        'pm2 no encontrado', 'YesNo', 'Question')
    if ($resp -eq [System.Windows.Forms.DialogResult]::Yes) {
        $r2 = Invoke-Logged -Exe 'npm' -ArgsList @('install', '-g', 'pm2')
        if ($r2.ExitCode -eq 0) {
            $script:S.Pm2Ok = $true
            return @{ Status = 'OK'; Message = 'pm2 instalado correctamente.' }
        }
        return @{ Status = 'WARN'; Message = 'La instalación de pm2 falló -- revisa el log arriba. Instálalo a mano antes de start.bat.' }
    }
    return @{ Status = 'WARN'; Message = 'pm2 no quedó instalado -- instálalo antes de start.bat (npm install -g pm2).' }
}

function Step-NpmCi {
    $needsFresh = $false
    if (-not (Test-Path 'node_modules')) {
        Append-Log 'node_modules no existe todavía.'
        $needsFresh = $true
    } else {
        $r = Invoke-Logged -Exe 'node' -ArgsList @('-e', "try { require('better-sqlite3'); console.log('LIBOK') } catch(e) { console.log('FALLA') }")
        if ($r.StdOut -notmatch 'LIBOK') {
            Append-Log 'better-sqlite3 no carga (node_modules corrupto o de otra version de Node/Windows).'
            $needsFresh = $true
        }
    }
    if ($needsFresh -and (Test-Path 'node_modules')) {
        Append-Log 'Borrando node_modules para reinstalar desde cero...'
        Remove-Item -Recurse -Force 'node_modules'
    }
    $r = Invoke-Logged -Exe 'npm' -ArgsList @('ci')
    if ($r.ExitCode -ne 0) {
        return @{ Status = 'ERROR'; Message = 'npm ci falló. Revisa el log arriba (¿faltan Python/compilador para algún módulo nativo?).' }
    }
    return @{ Status = 'OK'; Message = 'Dependencias instaladas (npm ci).' }
}

function Step-DashboardUi {
    $r1 = Invoke-Logged -Exe 'npm' -ArgsList @('install') -WorkDir (Join-Path $script:RepoRoot 'dashboard-ui')
    if ($r1.ExitCode -ne 0) {
        return @{ Status = 'WARN'; Message = 'npm install en dashboard-ui falló. El dashboard caerá al HTML clásico (dashboard.html).' }
    }
    $r2 = Invoke-Logged -Exe 'npm' -ArgsList @('run', 'build') -WorkDir (Join-Path $script:RepoRoot 'dashboard-ui')
    if ($r2.ExitCode -ne 0) {
        return @{ Status = 'WARN'; Message = 'El build de dashboard-ui falló. El dashboard caerá al HTML clásico (dashboard.html).' }
    }
    return @{ Status = 'OK'; Message = 'Panel en React compilado (dashboard-ui/dist).' }
}

function Step-Desktop {
    $r = Invoke-Logged -Exe 'npm' -ArgsList @('install') -WorkDir (Join-Path $script:RepoRoot 'desktop')
    if ($r.ExitCode -ne 0) {
        return @{ Status = 'WARN'; Message = 'npm install en desktop falló. start.bat no podrá abrir la ventana de escritorio.' }
    }
    return @{ Status = 'OK'; Message = 'Ventana de escritorio (Electron) lista.' }
}

function Step-Env {
    if (Test-Path '.env') {
        $form = Show-WizardForm -Titulo 'Archivo .env' `
            -Intro 'Ya existe un .env en esta carpeta. ¿Qué quieres hacer?' `
            -Campos @(
                @{ Key = 'Modo'; Label = 'Elige una opción:'; Type = 'Choice'; Default = 'U'; Choices = @(
                        @{ Key = 'U'; Label = 'Usar el .env existente, sin cambios' },
                        @{ Key = 'O'; Label = 'Apuntar a OTRO archivo .env ya existente' },
                        @{ Key = 'N'; Label = 'Crear uno nuevo, paso a paso (sobrescribe el actual)' }
                    )
                }
            )
        if (-not $form) { return @{ Status = 'WARN'; Message = 'Cancelado -- se deja el .env existente sin cambios.' } }
        $modo = $form.Modo
    } else {
        $form = Show-WizardForm -Titulo 'Archivo .env' `
            -Intro 'No existe un .env todavía en esta carpeta. ¿Ya tienes uno de otra instalación/backup, o prefieres llenarlo paso a paso?' `
            -Campos @(
                @{ Key = 'Modo'; Label = 'Elige una opción:'; Type = 'Choice'; Default = 'N'; Choices = @(
                        @{ Key = 'O'; Label = 'Ya tengo un .env de otra instalación/backup' },
                        @{ Key = 'N'; Label = 'Llenarlo paso a paso (guiado)' }
                    )
                }
            )
        if (-not $form) { return @{ Status = 'ERROR'; Message = 'No se configuró .env -- créalo manualmente antes de arrancar.' } }
        $modo = $form.Modo
    }

    if ($modo -eq 'U') {
        return @{ Status = 'OK'; Message = '.env existente, sin cambios.' }
    }

    if ($modo -eq 'O') {
        $formOrigen = Show-WizardForm -Titulo 'Copiar .env existente' -Campos @(
            @{ Key = 'Origen'; Label = 'Ruta completa al archivo .env a usar'; Type = 'Path'; PathMode = 'Open'; Default = '' }
        )
        if (-not $formOrigen -or -not $formOrigen.Origen -or -not (Test-Path $formOrigen.Origen)) {
            return @{ Status = 'ERROR'; Message = 'No se encontró el archivo .env indicado.' }
        }
        Copy-Item $formOrigen.Origen '.env' -Force
        return @{ Status = 'OK'; Message = ".env copiado desde: $($formOrigen.Origen)" }
    }

    # Modo "N" -- guiado paso a paso
    if (-not (Test-Path '.env.example')) {
        return @{ Status = 'ERROR'; Message = 'No existe .env.example -- no se puede generar un .env nuevo guiado.' }
    }
    Copy-Item '.env.example' '.env' -Force
    $formGuiado = Show-WizardForm -Titulo 'Configurar .env paso a paso' `
        -Intro 'Deja vacío cualquier campo opcional -- se puede completar después editando .env a mano.' `
        -Campos @(
            @{ Key = 'NombreNegocio'; Label = 'Nombre del negocio (para personalizar al bot)'; Type = 'Text'; Default = '' },
            @{ Key = 'Tono'; Label = 'Tono del bot:'; Type = 'Choice'; Default = 'C'; Choices = @(
                    @{ Key = 'A'; Label = 'A — Formal' }, @{ Key = 'B'; Label = 'B — Casual' },
                    @{ Key = 'C'; Label = 'C — Amigable (recomendado)' }, @{ Key = 'D'; Label = 'D — Ventas / urgencia' }
                )
            },
            @{ Key = 'DashboardUser'; Label = 'Usuario admin del dashboard'; Type = 'Text'; Default = 'admin' },
            @{ Key = 'DashboardPass'; Label = 'Password del usuario admin del dashboard'; Type = 'Password'; Default = '' },
            @{ Key = 'UserPrime'; Label = 'Usuario "prime" (inventario/sucursales) -- vacío si no se usa todavía'; Type = 'Text'; Default = '' },
            @{ Key = 'UserPrimePass'; Label = 'Password del usuario prime'; Type = 'Password'; Default = '' },
            @{ Key = 'ChromePath'; Label = 'Ruta a chrome.exe / chromium'; Type = 'Path'; PathMode = 'Open'; Default = ($script:S.ChromePath) },
            @{ Key = 'AsesorWhatsapp'; Label = 'WhatsApp del asesor humano (con código de país, ej. 521...)'; Type = 'Text'; Default = '' },
            @{ Key = 'FleteUmbral'; Label = 'Monto mínimo de compra para envío gratis'; Type = 'Text'; Default = '699' }
        )
    if (-not $formGuiado) {
        return @{ Status = 'WARN'; Message = '.env creado desde la plantilla, pero el llenado guiado se canceló -- revísalo a mano.' }
    }
    $script:S.NombreNegocio = $formGuiado.NombreNegocio
    $script:S.TonoBot = $formGuiado.Tono
    Set-EnvVar 'DASHBOARD_USER' $formGuiado.DashboardUser
    if ($formGuiado.DashboardPass) { Set-EnvVar 'DASHBOARD_PASS' $formGuiado.DashboardPass }
    if ($formGuiado.UserPrime) {
        Set-EnvVar 'USER_PRIME' $formGuiado.UserPrime
        Set-EnvVar 'USER_PRIME_PASSWORD' $formGuiado.UserPrimePass
    }
    if ($formGuiado.ChromePath) { Set-EnvVar 'CHROME_PATH' $formGuiado.ChromePath }
    Set-EnvVar 'ASESOR_WHATSAPP' $formGuiado.AsesorWhatsapp
    Set-EnvVar 'FLETE_UMBRAL' $formGuiado.FleteUmbral
    return @{ Status = 'OK'; Message = '.env creado paso a paso.' }
}

function Step-Db {
    $dbPathActual = $null
    if (Test-Path '.env') {
        $m = [regex]::Match((Get-Content '.env' -Raw), '(?m)^DB_PATH=(.*)$')
        if ($m.Success) { $dbPathActual = $m.Groups[1].Value.Trim() }
    }
    if ($dbPathActual -and (Test-Path $dbPathActual)) {
        Invoke-Logged -Exe 'node' -ArgsList @('scripts/instalarBaseDeDatos.js', 'verificar-y-completar', $dbPathActual) | Out-Null
        $script:S.DbOk = $true
        return @{ Status = 'OK'; Message = "DB_PATH ya apuntaba a un archivo existente y se verificó/completó: $dbPathActual" }
    }

    $formModo = Show-WizardForm -Titulo 'Base de datos' `
        -Intro '¿Qué hacer con la base de datos del bot?' `
        -Campos @(
            @{ Key = 'Modo'; Label = 'Elige una opción:'; Type = 'Choice'; Default = 'N'; Choices = @(
                    @{ Key = 'N'; Label = 'Crear una base de datos NUEVA desde cero' },
                    @{ Key = 'E'; Label = 'Ya tengo una -- solo apuntarla/completarla' }
                )
            }
        )
    if (-not $formModo) {
        return @{ Status = 'ERROR'; Message = 'No se configuró la base de datos -- define DB_PATH manualmente en .env.' }
    }

    if ($formModo.Modo -eq 'E') {
        $formRuta = Show-WizardForm -Titulo 'Base de datos existente' -Campos @(
            @{ Key = 'Ruta'; Label = 'Ruta completa al archivo .db existente'; Type = 'Path'; PathMode = 'Open'; Default = '' }
        )
        if (-not $formRuta -or -not $formRuta.Ruta) {
            return @{ Status = 'ERROR'; Message = 'No se indicó ninguna ruta -- define DB_PATH manualmente en .env.' }
        }
        $salida = Invoke-Logged -Exe 'node' -ArgsList @('scripts/instalarBaseDeDatos.js', 'verificar-y-completar', $formRuta.Ruta)
        $descModo = 'existente, verificada/completada'
    } else {
        $defaultPath = Join-Path $script:RepoRoot 'db\jugueteria.db'
        $formRuta = Show-WizardForm -Titulo 'Base de datos nueva' -Campos @(
            @{ Key = 'Ruta'; Label = 'Ruta donde crear la base de datos nueva'; Type = 'Path'; PathMode = 'Save'; Default = $defaultPath }
        )
        if (-not $formRuta -or -not $formRuta.Ruta) {
            return @{ Status = 'ERROR'; Message = 'No se indicó ninguna ruta -- define DB_PATH manualmente en .env.' }
        }
        $argsDb = @('scripts/instalarBaseDeDatos.js', 'crear-nueva', $formRuta.Ruta)
        if ($script:S.NombreNegocio) {
            $argsDb += $script:S.NombreNegocio
            if ($script:S.TonoBot) { $argsDb += $script:S.TonoBot }
        }
        $salida = Invoke-Logged -Exe 'node' -ArgsList $argsDb
        $descModo = 'nueva, creada desde cero'
    }

    $lineaDbPath = ($salida.StdOut -split "`n") | Where-Object { $_ -match '^DB_PATH=' } | Select-Object -Last 1
    if ($lineaDbPath) {
        $dbPathResultante = $lineaDbPath -replace '^DB_PATH=', ''
        Set-EnvVar 'DB_PATH' $dbPathResultante
        $script:S.DbOk = $true
        return @{ Status = 'OK'; Message = "DB_PATH escrito en .env ($descModo): $dbPathResultante" }
    }
    return @{ Status = 'ERROR'; Message = 'No se pudo determinar la ruta de la base de datos -- revisa el log arriba y define DB_PATH manualmente en .env.' }
}

function Step-Migrate {
    if (-not $script:S.DbOk) {
        return @{ Status = 'WARN'; Message = 'Omitido -- la base de datos no quedó configurada en el paso anterior.' }
    }
    $r = Invoke-Logged -Exe 'node' -ArgsList @('scripts/migrate.js')
    if ($r.ExitCode -eq 0) {
        return @{ Status = 'OK'; Message = 'Migraciones al día.' }
    }
    return @{ Status = 'WARN'; Message = 'Alguna migración falló -- revisa el log arriba antes de arrancar el bot.' }
}

$script:Steps = @(
    @{ Name = 'Node.js'; Desc = 'Verifica que Node.js 20.x esté instalado y en PATH.'; Critical = $true; Action = ${function:Step-Node} }
    @{ Name = 'npm'; Desc = 'Verifica que npm esté disponible (viene junto con Node.js).'; Critical = $true; Action = ${function:Step-Npm} }
    @{ Name = 'Chrome / Chromium'; Desc = 'Busca Chrome instalado para usarlo como CHROME_PATH (lo necesita el bot para abrir WhatsApp Web).'; Critical = $false; Action = ${function:Step-Chrome} }
    @{ Name = 'pm2'; Desc = 'Verifica el gestor de procesos pm2, usado para encender/apagar el bot y el dashboard.'; Critical = $false; Action = ${function:Step-Pm2} }
    @{ Name = 'Dependencias (npm ci)'; Desc = 'Instala las dependencias del proyecto exactas al package-lock.json. Puede tardar varios minutos.'; Critical = $true; Action = ${function:Step-NpmCi} }
    @{ Name = 'Panel (dashboard-ui)'; Desc = 'Instala y compila el panel de administración en React (dashboard-ui/dist).'; Critical = $false; Action = ${function:Step-DashboardUi} }
    @{ Name = 'Ventana de escritorio'; Desc = 'Instala las dependencias de la ventana de escritorio (Electron/desktop), usada por start.bat.'; Critical = $false; Action = ${function:Step-Desktop} }
    @{ Name = 'Archivo .env'; Desc = 'Configura las variables de entorno del bot (usuarios, tono, WhatsApp del asesor, etc.).'; Critical = $false; Action = ${function:Step-Env} }
    @{ Name = 'Base de datos'; Desc = 'Crea una base de datos nueva, o verifica/completa una que ya tengas.'; Critical = $false; Action = ${function:Step-Db} }
    @{ Name = 'Migraciones'; Desc = 'Aplica migraciones versionadas pendientes (migrations/*.sql) -- red de seguridad, normalmente no hace nada nuevo.'; Critical = $false; Action = ${function:Step-Migrate} }
)

# ───────────────────────── Ventana principal del asistente ──────────────────
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Instalador — Chatbot Julio Cepeda'
$form.Width = 980
$form.Height = 680
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false

$lblTitulo = New-Object System.Windows.Forms.Label
$lblTitulo.Text = 'Instalador — Chatbot Julio Cepeda'
$lblTitulo.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
$lblTitulo.SetBounds(16, 12, 700, 30)
$form.Controls.Add($lblTitulo)

$lblPaso = New-Object System.Windows.Forms.Label
$lblPaso.Text = ''
$lblPaso.SetBounds(16, 46, 700, 20)
$form.Controls.Add($lblPaso)

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.SetBounds(16, 70, 932, 18)
$progress.Minimum = 0
$progress.Maximum = $script:Steps.Count
$form.Controls.Add($progress)

$listaPasos = New-Object System.Windows.Forms.ListBox
$listaPasos.SetBounds(16, 100, 260, 460)
$listaPasos.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
foreach ($p in $script:Steps) { [void]$listaPasos.Items.Add("⏳  $($p.Name)") }
$form.Controls.Add($listaPasos)

$grpDesc = New-Object System.Windows.Forms.GroupBox
$grpDesc.Text = 'Qué hace este paso'
$grpDesc.SetBounds(288, 100, 660, 70)
$lblDesc = New-Object System.Windows.Forms.Label
$lblDesc.SetBounds(12, 22, 636, 40)
$lblDesc.Text = ''
$grpDesc.Controls.Add($lblDesc)
$form.Controls.Add($grpDesc)

$script:LogBox = New-Object System.Windows.Forms.RichTextBox
$script:LogBox.SetBounds(288, 180, 660, 340)
$script:LogBox.Font = New-Object System.Drawing.Font('Consolas', 9)
$script:LogBox.ReadOnly = $true
$script:LogBox.BackColor = [System.Drawing.Color]::White
$form.Controls.Add($script:LogBox)

$lblEstado = New-Object System.Windows.Forms.Label
$lblEstado.SetBounds(288, 528, 660, 24)
$lblEstado.Font = New-Object System.Drawing.Font('Segoe UI', 9.5, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($lblEstado)

$btnAccion = New-Object System.Windows.Forms.Button
$btnAccion.Text = 'Ejecutar este paso ▶'
$btnAccion.SetBounds(696, 590, 160, 32)
$form.Controls.Add($btnAccion)

$btnCerrar = New-Object System.Windows.Forms.Button
$btnCerrar.Text = 'Cancelar'
$btnCerrar.SetBounds(864, 590, 84, 32)
$form.Controls.Add($btnCerrar)
$btnCerrar.Add_Click({ $form.Close() })

$script:idx = 0
$script:yaEjecutado = $false
$script:abortado = $false

function Actualizar-PantallaPaso {
    $p = $script:Steps[$script:idx]
    $lblPaso.Text = "Paso $($script:idx + 1) de $($script:Steps.Count): $($p.Name)"
    $lblDesc.Text = $p.Desc
    $lblEstado.Text = ''
    $script:LogBox.Clear()
    $btnAccion.Text = 'Ejecutar este paso ▶'
    $script:yaEjecutado = $false
    for ($i = 0; $i -lt $listaPasos.Items.Count; $i++) {
        $nombre = $script:Steps[$i].Name
        if ($i -lt $script:idx) {
            # se conserva el ícono que ya se puso al ejecutarlo
        } elseif ($i -eq $script:idx) {
            $listaPasos.Items[$i] = "▶  $nombre"
        } else {
            $listaPasos.Items[$i] = "⏳  $nombre"
        }
    }
    $listaPasos.SelectedIndex = $script:idx
}

function Mostrar-Resumen-Final {
    $lblPaso.Text = 'Instalación terminada'
    $lblDesc.Text = 'Revisa el resumen abajo. Si todo salió en verde/amarillo, ya puedes cerrar esta ventana y correr start.bat (o npm run start:all).'
    $lblEstado.Text = ''
    $script:LogBox.Clear()
    foreach ($r in $script:Resultados) {
        $marca = switch ($r.Status) { 'OK' { 'OK' } 'WARN' { 'AVISO' } default { 'ERROR' } }
        Append-Log "[$marca] $($r.Name): $($r.Message)"
    }
    if (-not $script:S.Pm2Ok) { Append-Log "`n(pm2 no quedó instalado -- instálalo antes de start:all)" }
    $btnAccion.Visible = $false
    $btnCerrar.Text = 'Cerrar'
}

$script:Resultados = @()

$btnAccion.Add_Click({
    if ($script:abortado) { return }

    if (-not $script:yaEjecutado) {
        $p = $script:Steps[$script:idx]
        $btnAccion.Enabled = $false
        $lblEstado.Text = 'Ejecutando...'
        $lblEstado.ForeColor = [System.Drawing.Color]::DarkSlateGray
        [System.Windows.Forms.Application]::DoEvents()

        $resultado = & $p.Action
        $script:Resultados += [PSCustomObject]@{ Name = $p.Name; Status = $resultado.Status; Message = $resultado.Message }

        $icono = switch ($resultado.Status) { 'OK' { '✅' } 'WARN' { '⚠️' } default { '❌' } }
        $listaPasos.Items[$script:idx] = "$icono  $($p.Name)"
        $lblEstado.Text = $resultado.Message
        $lblEstado.ForeColor = switch ($resultado.Status) {
            'OK' { [System.Drawing.Color]::ForestGreen }
            'WARN' { [System.Drawing.Color]::DarkOrange }
            default { [System.Drawing.Color]::Firebrick }
        }
        $progress.Value = $script:idx + 1

        if ($resultado.Status -eq 'ERROR' -and $p.Critical) {
            Append-Log "`nNo se puede continuar -- corrige esto y vuelve a abrir el asistente."
            $script:abortado = $true
            $btnAccion.Text = 'Detenido'
            $btnAccion.Enabled = $false
            $btnCerrar.Text = 'Cerrar'
            return
        }

        $script:yaEjecutado = $true
        $btnAccion.Enabled = $true
        if ($script:idx -eq $script:Steps.Count - 1) {
            $btnAccion.Text = 'Finalizar ▶'
        } else {
            $btnAccion.Text = 'Siguiente ▶'
        }
        return
    }

    if ($script:idx -ge $script:Steps.Count - 1) {
        Mostrar-Resumen-Final
        return
    }
    $script:idx++
    Actualizar-PantallaPaso
})

Actualizar-PantallaPaso
[void]$form.ShowDialog()
