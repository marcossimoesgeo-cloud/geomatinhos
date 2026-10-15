@echo off
title Geoportal Matinhos - Servidores Locais
chcp 65001 >nul
echo ============================================================
echo   GEOPORTAL - PREFEITURA MUNICIPAL DE MATINHOS
echo   Secretaria Municipal de Urbanismo
echo ============================================================
echo Iniciando servidores locais...

start "Geoportal - Tile Server Ortofoto (8081)" cmd /k ""C:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat" "%~dp0tile_server_ortofoto.py""
timeout /t 2 /nobreak >nul
start "Geoportal - Web Server (8080)" cmd /k ""C:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat" "%~dp0server.py""

echo.
echo [OK] Servidores inicializados!
echo Geoportal Web: http://localhost:8080
echo Tile Server:   http://localhost:8081
echo.
