# Liga o servidor do quiz + túnel da Cloudflare e abre o painel do formador.
# O endereço da Cloudflare entra sozinho no QR code (não é preciso copiar nada).
# A palavra-passe do formador está em data\palavra-passe-formador.txt.

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle = 'Quiz - online'

function Pausa { Write-Host ''; Read-Host 'Carrega em Enter para fechar' | Out-Null }
# volta a ler o PATH (para encontrar programas acabados de instalar sem reabrir a janela)
function AtualizarPath { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }

try {
  # 1. Node.js
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Falta o Node.js. Instala-o em https://nodejs.org (versão LTS) e volta a abrir este ficheiro.' -ForegroundColor Red
    Pausa; exit 1
  }

  # 2. cloudflared (instala sozinho com o winget, se faltar)
  if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Host 'Falta o cloudflared (o túnel da Cloudflare). Vou instalá-lo...' -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
      AtualizarPath
    }
    if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
      Write-Host 'Não consegui instalar o cloudflared. Corre:  winget install --id Cloudflare.cloudflared' -ForegroundColor Red
      Write-Host 'O quiz vai arrancar na mesma, mas só na rede local (sem endereço da internet).' -ForegroundColor Yellow
    }
  }

  # 3. dependências (só da primeira vez)
  if (-not (Test-Path 'node_modules')) {
    Write-Host 'A instalar as dependências (só da primeira vez)...' -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install falhou.' }
  }

  # 4. abre o painel do formador daqui a 4 segundos (o servidor já está pronto)
  Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', 'Start-Sleep -Seconds 4; Start-Process "http://localhost:3000/host.html"'

  # 5. servidor + túnel (fica a correr nesta janela; fecha a janela para desligar)
  Write-Host 'A ligar o servidor e o túnel... (fecha esta janela para desligar tudo)' -ForegroundColor Green
  npm run online
}
catch {
  Write-Host "Erro: $($_.Exception.Message)" -ForegroundColor Red
}
Pausa
