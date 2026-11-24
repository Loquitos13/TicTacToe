@echo off
rem Duplo clique: liga o servidor + túnel da Cloudflare e abre o painel do formador.
rem A palavra-passe do formador está em data\palavra-passe-formador.txt (podes mudá-la lá).
cd /d "%~dp0"
title Quiz - online
if not exist node_modules call npm install
start "" /min cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:3000/host.html"
call npm run online
pause
