@echo off
rem Duplo clique: corre o iniciar-online.ps1 (servidor + túnel da Cloudflare + painel do formador).
rem Serve para não teres de mexer nas permissões do PowerShell.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar-online.ps1"
