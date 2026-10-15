# -*- coding: utf-8 -*-
"""
Inicializador dos Servidores Locais - Geoportal de Matinhos
Secretaria Municipal de Urbanismo
"""
import subprocess
import os
import sys
import time
import webbrowser

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
QGIS_PYTHON_BAT = r"C:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat"

def main():
    print("=" * 60)
    print("  GEOPORTAL - PREFEITURA MUNICIPAL DE MATINHOS")
    print("  Secretaria Municipal de Urbanismo")
    print("=" * 60)
    print("Iniciando servidores locais...")

    tile_server = os.path.join(CURRENT_DIR, "tile_server_ortofoto.py")
    web_server = os.path.join(CURRENT_DIR, "server.py")

    # Iniciar Tile Server (porta 8081)
    subprocess.Popen([QGIS_PYTHON_BAT, tile_server], creationflags=subprocess.CREATE_NEW_CONSOLE)
    time.sleep(2)

    # Iniciar Web Server (porta 8080)
    subprocess.Popen([QGIS_PYTHON_BAT, web_server], creationflags=subprocess.CREATE_NEW_CONSOLE)

    print("\n[OK] Servidores inicializados!")
    print("Geoportal Web: http://localhost:8080")
    print("Tile Server:   http://localhost:8081\n")
    time.sleep(2)
    webbrowser.open("http://localhost:8080")

if __name__ == "__main__":
    main()
