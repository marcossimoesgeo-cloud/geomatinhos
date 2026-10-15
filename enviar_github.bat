@echo off
title Enviar Geoportal para o GitHub
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================================
echo   ENVIANDO GEOPORTAL DE MATINHOS PARA O GITHUB
echo ============================================================
echo.
echo Repositorio: https://github.com/marcossimoesgeo-cloud/zoneamento.git
echo Branch:      main
echo.
echo Se solicitado, selecione "Sign in with your browser" e autorize no GitHub.
echo.
"%LOCALAPPDATA%\Programs\Git\cmd\git.exe" push -u origin main
echo.
if %ERRORLEVEL% equ 0 (
    echo ============================================================
    echo [SUCESSO] Codigo enviado com sucesso para o GitHub!
    echo ============================================================
) else (
    echo [ATENCAO] Ocorreu uma falha no envio.
)
echo.
pause
