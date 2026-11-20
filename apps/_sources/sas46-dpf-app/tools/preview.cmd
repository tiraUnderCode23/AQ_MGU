@echo off
setlocal
cd /d "%~dp0.."
if not exist "dist\idrive7_dpf_app\source\javascript\app.js" (
  echo Build the app first with tools\build-local.cmd
  exit /b 2
)
node kit\tools\preview.js dist\idrive7_dpf_app preview BTN_LIVE BTN_HISTORY
if errorlevel 1 exit /b %errorlevel%
echo Preview frames saved in preview\
