# Executar como Administrador — configura o alias "projetozoneamento" no hosts
$hostsPath = "C:\Windows\System32\drivers\etc\hosts"
$entry = "127.0.0.1`tprojetozoneamento`t# Geoportal - Prefeitura de Matinhos"

$existing = Select-String -Path $hostsPath -Pattern "projetozoneamento" -Quiet
if ($existing) {
    Write-Host "[OK] Alias 'projetozoneamento' ja esta configurado!" -ForegroundColor Green
} else {
    Add-Content -Path $hostsPath -Value "`n$entry" -Encoding ASCII
    Write-Host "[OK] Alias adicionado com sucesso!" -ForegroundColor Green
}
Write-Host ""
Write-Host "Agora acesse o geoportal em: http://projetozoneamento:8080" -ForegroundColor Cyan
Write-Host ""
pause
