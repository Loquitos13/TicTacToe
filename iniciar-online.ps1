# Liga o servidor do quiz + túnel da Cloudflare e abre o painel do formador.
# O endereço da Cloudflare entra sozinho no QR code (não é preciso copiar nada).
# A palavra-passe do formador está em data\palavra-passe-formador.txt.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # descargas muito mais rápidas no PowerShell 5
Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle = 'Quiz - online'
$env:NODE_NO_WARNINGS = '1'                # esconde avisos do Node que não interessam
$porta = 3000
$ferramentas = Join-Path $PSScriptRoot 'ferramentas'
$cfLocal = Join-Path $ferramentas 'cloudflared.exe'

function Pausa { Write-Host ''; Read-Host 'Carrega em Enter para fechar' | Out-Null }
# volta a ler o PATH (para encontrar programas acabados de instalar sem reabrir a janela)
function AtualizarPath { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function TemCloudflared { (Test-Path $cfLocal) -or [bool](Get-Command cloudflared -ErrorAction SilentlyContinue) }

try {
  # 1. Node.js
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Falta o Node.js. Instala-o em https://nodejs.org (versão LTS) e volta a abrir este ficheiro.' -ForegroundColor Red
    Pausa; exit 1
  }

  # 2. porta ocupada: normalmente é o quiz que ficou aberto noutra janela
  $ocupada = Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($ocupada) {
    $proc = Get-Process -Id $ocupada.OwningProcess -ErrorAction SilentlyContinue
    $nome = if ($proc) { $proc.ProcessName } else { 'outro programa' }
    Write-Host "A porta $porta já está a ser usada por: $nome" -ForegroundColor Yellow
    if ($nome -eq 'node') { Write-Host '(deve ser o quiz, aberto noutra janela; fechá-lo termina a sessão que estiver a decorrer)' -ForegroundColor Yellow }
    $r = Read-Host 'Fechar esse programa e arrancar o quiz de novo? (S/N)'
    if ($r -notmatch '^[sS]') { Write-Host 'Nada foi alterado.'; Pausa; exit 0 }
    Stop-Process -Id $ocupada.OwningProcess -Force
    Start-Sleep -Seconds 1
  }

  # 3. cloudflared: winget; se não houver winget, descarrega-o da Cloudflare (GitHub) para a pasta ferramentas\
  if (-not (TemCloudflared)) {
    Write-Host 'Falta o cloudflared (o túnel da Cloudflare). Vou instalá-lo...' -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
      AtualizarPath
    }
    if (-not (TemCloudflared)) {
      Write-Host 'A descarregar o cloudflared da página oficial da Cloudflare no GitHub...' -ForegroundColor Cyan
      try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        New-Item -ItemType Directory -Force -Path $ferramentas | Out-Null
        $arq = if ([Environment]::Is64BitOperatingSystem) { 'amd64' } else { '386' }
        Invoke-WebRequest -UseBasicParsing -OutFile $cfLocal -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-$arq.exe"
        Write-Host 'cloudflared pronto.' -ForegroundColor Green
      } catch {
        Remove-Item $cfLocal -ErrorAction SilentlyContinue
        Write-Host "Não consegui descarregar o cloudflared: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host 'O quiz vai arrancar na mesma, mas só na rede local (sem endereço da internet).' -ForegroundColor Yellow
      }
    }
  }

  # 4. dependências (só da primeira vez)
  if (-not (Test-Path 'node_modules')) {
    Write-Host 'A instalar as dependências (só da primeira vez)...' -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install falhou.' }
  }

  # 5. abre o painel do formador daqui a 4 segundos (o servidor já está pronto)
  Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', "Start-Sleep -Seconds 4; Start-Process 'http://localhost:$porta/host.html'"

  # 6. servidor + túnel (fica a correr nesta janela; fecha a janela para desligar)
  Write-Host 'A ligar o servidor e o túnel... (fecha esta janela para desligar tudo)' -ForegroundColor Green
  npm run online
}
catch {
  Write-Host "Erro: $($_.Exception.Message)" -ForegroundColor Red
}
Pausa
