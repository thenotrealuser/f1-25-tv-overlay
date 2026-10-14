@echo off
cd /d "%~dp0"
if not exist janela\node_modules (
  echo Instalando o Electron - so na primeira vez, pode demorar...
  pushd janela
  call npm install
  popd
)
start "Servidor F1 Overlay" cmd /k node server.js --debug
timeout /t 2 /nobreak >nul
pushd janela
call npx electron .
popd
