@echo off
rem Duplo clique (uma vez): cria o endereço fixo do quiz no teu domínio da Cloudflare.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0configurar-dominio.ps1"
