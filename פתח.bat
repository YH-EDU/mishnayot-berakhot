@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo פותח את משניות ברכות...
python serve.py
pause
