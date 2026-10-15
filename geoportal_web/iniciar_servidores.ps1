# Servidores Locais - Geoportal de Matinhos
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  GEOPORTAL - PREFEITURA MUNICIPAL DE MATINHOS" -ForegroundColor Cyan
Write-Host "  Secretaria Municipal de Urbanismo" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Iniciando servidores locais..." -ForegroundColor Green

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonBat = "C:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat"

Start-Process -FilePath $pythonBat -ArgumentList "`"$scriptDir\tile_server_ortofoto.py`""
Start-Sleep -Seconds 2
Start-Process -FilePath $pythonBat -ArgumentList "`"$scriptDir\server.py`""

Write-Host ""
Write-Host "[OK] Servidores inicializados!" -ForegroundColor Green
Write-Host "Geoportal Web: http://localhost:8080" -ForegroundColor Yellow
Write-Host "Tile Server:   http://localhost:8081" -ForegroundColor Yellow

Start-Sleep -Seconds 2
Start-Process "http://localhost:8080"
