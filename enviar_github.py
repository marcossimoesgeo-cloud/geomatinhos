# -*- coding: utf-8 -*-
"""
Sincronização com o GitHub - Geoportal de Matinhos
Secretaria Municipal de Urbanismo
"""
import subprocess
import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
GIT_EXE = os.path.expandvars(r"%LOCALAPPDATA%\Programs\Git\cmd\git.exe")

def main():
    print("=" * 60)
    print("  ENVIANDO GEOPORTAL DE MATINHOS PARA O GITHUB")
    print("=" * 60)
    print(f"Diretório: {CURRENT_DIR}\n")
    
    git_cmd = GIT_EXE if os.path.exists(GIT_EXE) else "git"

    try:
        # Adicionar arquivos
        subprocess.run([git_cmd, "add", "-A"], cwd=CURRENT_DIR, check=True)
        
        # Commit
        res = subprocess.run([git_cmd, "commit", "-m", "Atualizacoes do Geoportal"], cwd=CURRENT_DIR, capture_output=True, text=True)
        if res.returncode == 0:
            print("[OK] Alterações commitadas.")
        else:
            print("[INFO] Nenhuma alteração pendente para commit.")
        
        # Push
        print("\nEnviando para o repositório remoto GitHub...")
        push_res = subprocess.run([git_cmd, "push", "origin", "main"], cwd=CURRENT_DIR)
        if push_res.returncode == 0:
            print("\n" + "=" * 60)
            print("[SUCESSO] Código enviado com sucesso para o GitHub!")
            print("=" * 60)
        else:
            print("\n[ERRO] Falha no envio. Verifique conexão e credenciais.")
    except Exception as e:
        print(f"\n[ERRO] {e}")

    try:
        input("\nPressione Enter para fechar...")
    except Exception:
        pass

if __name__ == "__main__":
    main()
