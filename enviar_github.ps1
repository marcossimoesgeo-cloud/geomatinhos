# Sincronização com o GitHub - Geoportal de Matinhos
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  ENVIANDO GEOPORTAL DE MATINHOS PARA O GITHUB" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$gitExe = "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe"

& $gitExe -C $scriptDir add -A
& $gitExe -C $scriptDir commit -m "Atualizacoes do Geoportal"
& $gitExe -C $scriptDir push origin main

Write-Host ""
Write-Host "[OK] Processo de sincronizacao concluido." -ForegroundColor Green
Read-Host "Pressione Enter para sair..."
