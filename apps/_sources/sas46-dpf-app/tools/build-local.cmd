@echo off
setlocal
cd /d "%~dp0.."
if not exist "oap-sdk\index.js" (
  echo Missing oap-sdk\index.js
  echo Extract the OAP SDK ZIP supplied from your own MGU into the project root.
  exit /b 2
)
python kit\tools\build.py idrive7_dpf_app
if errorlevel 1 exit /b %errorlevel%
echo.
echo Build completed: dist\idrive7_dpf_app@0.1.6.mgu
