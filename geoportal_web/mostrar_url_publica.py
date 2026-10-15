"""
Monitora o ngrok e exibe a URL publica do geoportal.
Tambem pode atualizar o app.js com a URL do tile server se necessario.
"""
import urllib.request
import json
import time
import sys

def get_ngrok_url(retries=20, delay=2):
    for i in range(retries):
        try:
            with urllib.request.urlopen("http://localhost:4040/api/tunnels", timeout=3) as r:
                data = json.loads(r.read())
                tunnels = data.get("tunnels", [])
                for t in tunnels:
                    if t.get("proto") == "https":
                        return t["public_url"]
                    if t.get("proto") == "http":
                        return t["public_url"].replace("http://", "https://")
        except Exception:
            pass
        if i < retries - 1:
            time.sleep(delay)
    return None

if __name__ == "__main__":
    print("Aguardando ngrok iniciar...")
    url = get_ngrok_url()
    if url:
        print(f"\n{'='*55}")
        print(f"  GEOPORTAL DISPONIVEL PUBLICAMENTE:")
        print(f"  {url}")
        print(f"{'='*55}")
        print(f"\nCompartilhe esse link — qualquer pessoa pode acessar.")
        print(f"O link fica ativo enquanto esta maquina estiver ligada.")
        print(f"\nPressione Ctrl+C para encerrar.")
        # Manter rodando para mostrar o URL
        try:
            while True:
                time.sleep(60)
                new_url = get_ngrok_url(retries=3, delay=1)
                if new_url and new_url != url:
                    url = new_url
                    print(f"\n[ATUALIZADO] Nova URL: {url}")
        except KeyboardInterrupt:
            print("\nEncerrado.")
    else:
        print("Nao foi possivel obter URL do ngrok.")
        print("Verifique se ngrok esta rodando e o token esta configurado.")
        sys.exit(1)
