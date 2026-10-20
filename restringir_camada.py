# -*- coding: utf-8 -*-
"""
Torna uma camada RESTRITA (visível só para servidores logados).

Uso:
    python restringir_camada.py ID_DA_CAMADA
    ex.: python restringir_camada.py area_de_preservacao

O que faz:
  1. Move geoportal_web/data/<arquivo>.geojson para a pasta local "restrito/" (ignorada pelo Git).
  2. Remove a camada de geoportal_web/data/config.json e o interruptor dela do index.html (público).
  3. Registra a camada em restrito/config_restrito.json.

Depois, no Supabase (Storage > bucket "restrito"), envie TODO o conteúdo da pasta "restrito/".
Servidores logados passam a ver a camada na seção "Camadas Restritas".

ATENÇÃO: arquivos já enviados ao GitHub continuam no HISTÓRICO público do repositório.
Para sigilo real, o repositório deve ser privado ou o histórico reescrito.
"""
import argparse
import json
import os
import re
import shutil
import sys

KEEP = ("id", "file", "title", "type", "color", "weight", "dashArray", "fill", "fillColor", "fillOpacity", "visible_default")


def main():
    ap = argparse.ArgumentParser(description="Move uma camada pública para a área restrita de servidores.")
    ap.add_argument("layer_id")
    ap.add_argument("--base", default=os.path.dirname(os.path.abspath(__file__)), help="pasta raiz do projeto")
    args = ap.parse_args()

    web = os.path.join(args.base, "geoportal_web")
    data = os.path.join(web, "data")
    cfg_path = os.path.join(data, "config.json")
    index_path = os.path.join(web, "index.html")
    out_dir = os.path.join(args.base, "restrito")
    man_path = os.path.join(out_dir, "config_restrito.json")

    with open(cfg_path, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    layer = next((l for l in cfg["layers"] if l["id"] == args.layer_id), None)
    if not layer:
        ids = ", ".join(l["id"] for l in cfg["layers"])
        sys.exit(f"Camada '{args.layer_id}' não encontrada. Camadas públicas: {ids}")

    src = os.path.join(data, layer["file"])
    if not os.path.isfile(src):
        sys.exit(f"Arquivo não encontrado: {src}")

    os.makedirs(out_dir, exist_ok=True)
    shutil.copy2(src, os.path.join(out_dir, layer["file"]))

    manifest = {"layers": []}
    if os.path.isfile(man_path):
        with open(man_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
    manifest["layers"] = [l for l in manifest["layers"] if l["id"] != layer["id"]]
    entry = {k: layer[k] for k in KEEP if k in layer}
    entry.setdefault("visible_default", False)
    manifest["layers"].append(entry)
    with open(man_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    cfg["layers"] = [l for l in cfg["layers"] if l["id"] != layer["id"]]
    with open(cfg_path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)

    with open(index_path, "r", encoding="utf-8") as f:
        html = f.read()
    pattern = re.compile(r'\n?[ \t]*<div class="layer-item"[^>]*>(?:(?!</div>).)*?id="layer-%s"(?:(?!</div>).)*?</div>' % re.escape(layer["id"]), re.S)
    html, n = pattern.subn("", html, count=1)
    with open(index_path, "w", encoding="utf-8", newline="") as f:
        f.write(html)

    os.remove(src)
    print(f"OK: '{layer['id']}' agora é restrita.")
    print(f" - arquivo movido para: {os.path.join(out_dir, layer['file'])}")
    print(f" - interruptor removido do index.html: {'sim' if n else 'NÃO ENCONTRADO (remova manualmente)'}")
    print(f"Próximo passo: envie o conteúdo da pasta '{out_dir}' ao bucket 'restrito' do Supabase.")
    print("Lembrete: versões antigas continuam no histórico público do Git.")


if __name__ == "__main__":
    main()
