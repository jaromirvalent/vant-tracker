@echo off
chcp 65001 >nul
title VANT Tracker
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js nie je nainstalovany. Stiahni ho z https://nodejs.org & pause & exit /b 1)
if not exist node_modules\@anthropic-ai\sdk (
  echo Instalujem zavislosti...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
)
start "" http://localhost:8787
node server.mjs
pause
