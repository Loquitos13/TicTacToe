# Corre UMA vez: cria um túnel fixo da Cloudflare com um subdomínio teu (ex.: quiz.oseudominio.pt).
# Depois disso o iniciar-online.bat usa sempre esse endereço: o QR code é sempre o mesmo
# e o suplemento do PowerPoint funciona. Não mexe no resto do teu domínio.

$ErrorActionPreference = 'Continue'        # os comandos do cloudflared escrevem avisos normais no stderr
$ProgressPreference = 'SilentlyContinue'
Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle = 'Quiz - configurar domínio'
$nome = 'quiz-formacao'                     # nome do túnel na tua conta da Cloudflare
$ferramentas = Join-Path $PSScriptRoot 'ferramentas'
$cfLocal = Join-Path $ferramentas 'cloudflared.exe'

function Pausa { Write-Host ''; Read-Host 'Carrega em Enter para fechar' | Out-Null }
function Falha($msg) { Write-Host $msg -ForegroundColor Red; Pausa; exit 1 }

# cloudflared: o da pasta ferramentas\, o instalado, ou descarrega-o da Cloudflare (GitHub)
if (Test-Path $cfLocal) { $cf = $cfLocal }
elseif (Get-Command cloudflared -ErrorAction SilentlyContinue) { $cf = (Get-Command cloudflared).Source }
else {
  Write-Host 'A descarregar o cloudflared da página oficial da Cloudflare no GitHub...' -ForegroundColor Cyan
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    New-Item -ItemType Directory -Force -Path $ferramentas | Out-Null
    $arq = if ([Environment]::Is64BitOperatingSystem) { 'amd64' } else { '386' }
    Invoke-WebRequest -UseBasicParsing -OutFile $cfLocal -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-$arq.exe"
    $cf = $cfLocal
  } catch { Falha "Não consegui descarregar o cloudflared: $($_.Exception.Message)" }
}

Write-Host ''
Write-Host 'Como queres criar o túnel?' -ForegroundColor Cyan
Write-Host '  1 = automático (recomendado): este script cria tudo na tua conta da Cloudflare'
Write-Host '  2 = já criei o túnel no painel da Cloudflare e tenho o token'
$op = (Read-Host 'Escolhe 1 ou 2').Trim()
if ($op -eq '2') {
  $sub = (Read-Host 'Endereço que puseste em "Public hostname" (ex.: quiz.oseudominio.pt)').Trim().ToLower() -replace '^https?://', '' -replace '/.*$', ''
  if ($sub -notmatch '^[a-z0-9-]+(\.[a-z0-9-]+)+$') { Falha "Endereço inválido: '$sub'" }
  Write-Host 'Cola o token (ou o comando inteiro que o painel mostra, "cloudflared.exe service install ..."):' -ForegroundColor Cyan
  $sec = Read-Host -AsSecureString
  $tok = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)).Trim()
  $tok = ($tok -split '\s+')[-1]          # se colou o comando inteiro, fica só o token (a última parte)
  if ($tok -notmatch '^[A-Za-z0-9+/=._-]{50,4000}$') { Falha 'Isso não parece um token de túnel. Copia-o outra vez no painel da Cloudflare.' }
  New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot 'data') | Out-Null
  [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'data\online.json'), '{ "token": "' + $tok + '", "url": "https://' + $sub + '" }')
  Write-Host ''
  Write-Host "Pronto! O quiz vai ficar em https://$sub" -ForegroundColor Green
  Write-Host 'Agora abre o iniciar-online.bat.' -ForegroundColor Green
  Pausa; exit 0
}

Write-Host ''
Write-Host 'Que endereço queres para o quiz? Tem de ser um subdomínio de um domínio que está na tua conta da Cloudflare.' -ForegroundColor Cyan
$sub = (Read-Host 'Endereço (ex.: quiz.oseudominio.pt)').Trim().ToLower() -replace '^https?://', '' -replace '/.*$', ''
if ($sub -notmatch '^[a-z0-9-]+(\.[a-z0-9-]+)+$') { Falha "Endereço inválido: '$sub'" }

# 1. autorizar este computador na tua conta da Cloudflare (abre o browser; só da primeira vez)
$cert = Join-Path $env:USERPROFILE '.cloudflared\cert.pem'
if (-not (Test-Path $cert)) {
  Write-Host ''
  Write-Host 'Vai abrir o browser: entra na tua conta da Cloudflare e escolhe o domínio (o que tem o subdomínio que escreveste).' -ForegroundColor Yellow
  & $cf tunnel login
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $cert)) { Falha 'A autorização na Cloudflare não terminou. Volta a correr este ficheiro.' }
}

# 2. túnel com nome fixo (se já existir, usa o mesmo)
& $cf tunnel info $nome *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "A criar o túnel '$nome'..." -ForegroundColor Cyan
  & $cf tunnel create $nome
  if ($LASTEXITCODE -ne 0) { Falha 'Não consegui criar o túnel.' }
}

# 3. o subdomínio passa a apontar para o túnel (cria o registo DNS na Cloudflare)
Write-Host "A apontar $sub para o túnel..." -ForegroundColor Cyan
& $cf tunnel route dns $nome $sub
if ($LASTEXITCODE -ne 0) { Falha "Não consegui apontar $sub para o túnel. Se esse subdomínio já existir no DNS da Cloudflare, apaga esse registo (ou escolhe outro nome) e volta a correr este ficheiro." }

# 4. guarda a configuração para o iniciar-online.bat
New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot 'data') | Out-Null
$json = '{ "tunnel": "' + $nome + '", "url": "https://' + $sub + '" }'
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'data\online.json'), $json)

Write-Host ''
Write-Host "Pronto! O quiz vai ficar em https://$sub" -ForegroundColor Green
Write-Host 'Agora abre o iniciar-online.bat. O QR code passa a ser sempre o mesmo e o suplemento do PowerPoint fica instalado.' -ForegroundColor Green
Pausa
