@echo off
rem Launch the local plan room on 127.0.0.1:3220 and open a browser.
rem ASCII-only on purpose: this file must survive the console codepage.
rem Stop the server by closing the "Plan Room 3220" window.
cd /d "%~dp0"
start "Plan Room 3220" /min node server.mjs
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:3220
