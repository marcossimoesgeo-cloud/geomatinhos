# =============================================================================
# Servidor de Tiles da Ortofoto — Geoportal de Matinhos
# Porta 8081 | Rota: /tiles/ortofoto/{z}/{x}/{y}.png
# v3 — Mascaramento aprimorado: canal alfa nativo do ECW + erosao numpy
# IMPORTANTE: env vars GDAL devem ser configurados ANTES do import osgeo
# =============================================================================

import os
import sys

# -- GDAL / ECW environment ---------------------------------------------------
QGIS_DIR = r"C:\Program Files\QGIS 3.44.14"
QGIS_BIN = os.path.join(QGIS_DIR, "bin")
GDAL_PLUGINS = os.path.join(QGIS_DIR, r"apps\gdal\lib\gdalplugins")
PROJ_DIR = os.path.join(QGIS_DIR, r"share\proj")

os.environ["GDAL_DRIVER_PATH"] = GDAL_PLUGINS
os.environ["GDAL_DATA"] = os.path.join(QGIS_DIR, r"apps\gdal\share\gdal")
os.environ["PROJ_DATA"] = PROJ_DIR
os.environ["PROJ_LIB"] = PROJ_DIR
os.environ["PATH"] = QGIS_BIN + os.pathsep + os.environ.get("PATH", "")

# -- Imports padrao -----------------------------------------------------------
import math
import threading
import struct
import zlib
import traceback
import numpy as np
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

# -- Import GDAL --------------------------------------------------------------
try:
    from osgeo import gdal, osr
    gdal.UseExceptions()
except ImportError as e:
    print(f"[ERRO] Nao foi possivel importar osgeo/gdal: {e}")
    sys.exit(1)

# -- Configuracoes ------------------------------------------------------------
PORT = 8081
ECW_PATH = (
    r"C:\Users\09472235921\Prefeitura de Matinhos"
    r"\urbanismo - Documentos\Area de Troca URB"
    r"\Marcos Geo\Geoportal\282_ORTO_MATINHOS_GSD_7cm_23_01_2026.ecw"
)

BBOX_3857 = (-5405962.40, -2980881.39, -5396020.55, -2961799.03)
TILE_SIZE  = 256

# Limiares de cor para pixels de "sem dado"
DARK_THRESH  = 8    # preto / quase-preto
LIGHT_THRESH = 250  # branco / quase-branco

# Erosao: raio em pixels para remover franjas de borda (0 = desativado)
EROSION_RADIUS = 3

# -- Dataset ECW (singleton thread-safe) --------------------------------------
_ds_lock     = threading.Lock()
_ds          = None
_has_alpha   = False   # True se ECW tiver banda alfa real
_nodata_val  = None    # valor nodata declarado

def get_dataset():
    global _ds, _has_alpha, _nodata_val
    if _ds is not None:
        return _ds
    with _ds_lock:
        if _ds is None:
            print(f"[INFO] Abrindo ortofoto: {ECW_PATH}")
            ds = gdal.Open(ECW_PATH, gdal.GA_ReadOnly)
            if ds is None:
                raise RuntimeError(f"GDAL nao conseguiu abrir: {ECW_PATH}")
            n = ds.RasterCount
            print(f"[INFO] OK - {ds.RasterXSize}x{ds.RasterYSize} px, {n} bandas")

            # Inspecionar bandas para detectar alfa
            for i in range(1, n + 1):
                band = ds.GetRasterBand(i)
                interp = band.GetColorInterpretation()
                nd = band.GetNoDataValue()
                print(f"  Banda {i}: interp={gdal.GetColorInterpretationName(interp)}, nodata={nd}")
                if interp == gdal.GCI_AlphaBand:
                    _has_alpha = True
                if nd is not None and i == 1:
                    _nodata_val = nd

            print(f"[INFO] Alfa nativo: {_has_alpha} | NoData: {_nodata_val}")
            _ds = ds
    return _ds

# -- Conversao XYZ -> bbox EPSG:3857 -----------------------------------------
_INITIAL_RES  = 2 * math.pi * 6378137.0 / TILE_SIZE
_ORIGIN_SHIFT = 2 * math.pi * 6378137.0 / 2.0

def tile_to_bbox_3857(x, y, z):
    res  = _INITIAL_RES / (2 ** z)
    minx = x       * TILE_SIZE * res - _ORIGIN_SHIFT
    maxx = (x + 1) * TILE_SIZE * res - _ORIGIN_SHIFT
    maxy = _ORIGIN_SHIFT - y       * TILE_SIZE * res
    miny = _ORIGIN_SHIFT - (y + 1) * TILE_SIZE * res
    return minx, miny, maxx, maxy

# -- PNG 1x1 transparente (fallback) -----------------------------------------
def _make_transparent_png():
    def chunk(name, data):
        c = zlib.crc32(name + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", c)
    sig  = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00\x00"))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend

TRANSPARENT_PNG = _make_transparent_png()

# -- Encoder PNG RGBA puro Python ---------------------------------------------
def encode_png_rgba(rgba):
    """Converte array numpy (H,W,4) uint8 -> bytes PNG RGBA."""
    H, W = rgba.shape[:2]
    def chunk(name, data):
        c = zlib.crc32(name + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", c)
    sig  = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))
    raw  = bytearray()
    for row in rgba:
        raw.append(0)
        raw.extend(row.tobytes())
    idat = chunk(b"IDAT", zlib.compress(bytes(raw), 6))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend

# -- Erosao binaria numpy (sem scipy) ----------------------------------------
def erode_bool(mask, radius):
    """
    Erosao binaria simples: um pixel so permanece valido se todos os vizinhos
    dentro do raio tambem forem validos. Remove franjas/ruidos de borda.
    """
    if radius <= 0:
        return mask
    H, W = mask.shape
    result = mask.copy()
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            if dy == 0 and dx == 0:
                continue
            # Calcular janela de origem e destino
            sy = max(0,  dy); ey = min(H, H + dy)
            sx = max(0,  dx); ex = min(W, W + dx)
            ty = max(0, -dy); fy = min(H, H - dy)
            tx = max(0, -dx); fx = min(W, W - dx)
            result[ty:fy, tx:fx] &= mask[sy:ey, sx:ex]
    return result

# -- Geracao de tile ----------------------------------------------------------
def render_tile(z, x, y):
    """
    Retorna bytes PNG RGBA ou None se fora do bbox.
    Estrategia de mascaramento (multiplas camadas):
      1. Canal alfa nativo do ECW (se disponivel via dstAlpha)
      2. Mascara de cor: pixels pretos e brancos -> transparente
      3. Erosao de borda: remove franjas de pixels residuais
    """
    t_minx, t_miny, t_maxx, t_maxy = tile_to_bbox_3857(x, y, z)
    b_minx, b_miny, b_maxx, b_maxy = BBOX_3857
    if t_maxx <= b_minx or t_minx >= b_maxx or t_maxy <= b_miny or t_miny >= b_maxy:
        return None

    srs_3857 = osr.SpatialReference()
    srs_3857.ImportFromEPSG(3857)
    wkt_3857 = srs_3857.ExportToWkt()

    src_ds = get_dataset()
    mem_drv = gdal.GetDriverByName("MEM")

    # Dataset de saida: 4 bandas RGBA
    out_ds = mem_drv.Create("", TILE_SIZE, TILE_SIZE, 4, gdal.GDT_Byte)
    out_ds.SetProjection(wkt_3857)
    out_ds.SetGeoTransform([
        t_minx, (t_maxx - t_minx) / TILE_SIZE, 0,
        t_maxy, 0, -(t_maxy - t_miny) / TILE_SIZE
    ])
    # Pre-preencher canal alfa com 0 (todo transparente antes do warp)
    out_ds.GetRasterBand(4).Fill(0)

    warp_opts = dict(
        format="MEM",
        dstSRS=wkt_3857,
        outputBounds=[t_minx, t_miny, t_maxx, t_maxy],
        width=TILE_SIZE,
        height=TILE_SIZE,
        resampleAlg=gdal.GRA_Bilinear,
        srcBands=[1, 2, 3],
        dstBands=[1, 2, 3],
        dstAlpha=True,   # GDAL gera alfa baseado em nodata/bordas automaticamente
    )
    # Adicionar nodata se conhecido
    if _nodata_val is not None:
        warp_opts["srcNodata"] = _nodata_val
        warp_opts["dstNodata"] = 0

    with _ds_lock:
        gdal.Warp(out_ds, src_ds, **warp_opts)

    # Ler bandas
    r = out_ds.GetRasterBand(1).ReadAsArray().astype(np.uint8)
    g = out_ds.GetRasterBand(2).ReadAsArray().astype(np.uint8)
    b = out_ds.GetRasterBand(3).ReadAsArray().astype(np.uint8)
    a = out_ds.GetRasterBand(4).ReadAsArray().astype(np.uint8)
    out_ds = None

    # --- Mascara combinada ---------------------------------------------------
    # 1) Alfa GDAL: pixels onde alfa > 0 sao candidatos a validos
    gdal_valid = a > 0

    # 2) Mascara de cor: eliminar pretos e brancos residuais
    is_black = (r <= DARK_THRESH)  & (g <= DARK_THRESH)  & (b <= DARK_THRESH)
    is_white = (r >= LIGHT_THRESH) & (g >= LIGHT_THRESH) & (b >= LIGHT_THRESH)

    # Mascara final valida: valido pelo GDAL E nao e cor de fundo
    valid = gdal_valid & ~is_black & ~is_white

    # 3) Erosao: remover franjas de 1-3 pixels nas bordas da imagem
    if EROSION_RADIUS > 0:
        valid = erode_bool(valid, EROSION_RADIUS)

    # Tile completamente vazio -> retornar PNG minimo
    if not valid.any():
        return TRANSPARENT_PNG

    # Construir canal alfa final
    alpha_out = np.where(valid, np.uint8(255), np.uint8(0))

    rgba = np.stack([r, g, b, alpha_out], axis=-1)
    return encode_png_rgba(rgba)

# -- Handler HTTP -------------------------------------------------------------
class TileHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        parsed = urlparse(self.path)
        seg = parsed.path.strip("/").split("/")

        if parsed.path == "/health":
            body = b"OK"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # /tiles/ortofoto/{z}/{x}/{y}.png
        if len(seg) == 5 and seg[0] == "tiles" and seg[1] == "ortofoto":
            try:
                z = int(seg[2])
                x = int(seg[3])
                y = int(seg[4].split(".")[0])
            except (ValueError, IndexError):
                self.send_response(400); self.end_headers(); return

            try:
                data = render_tile(z, x, y)
            except Exception:
                traceback.print_exc()
                self.send_response(500); self.end_headers(); return

            png_data = data if data is not None else TRANSPARENT_PNG
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(png_data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            self.wfile.write(png_data)
            return

        self.send_response(404)
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.end_headers()

# -- Main ---------------------------------------------------------------------
if __name__ == "__main__":
    try:
        get_dataset()
    except Exception as e:
        print(f"[ERRO FATAL] {e}")
        sys.exit(1)

    server = HTTPServer(("0.0.0.0", PORT), TileHandler)
    server.request_queue_size = 20
    print(f"[INFO] Tile server rodando em http://localhost:{PORT}")
    print(f"[INFO] Mascaramento: alfa GDAL + limiares de cor + erosao r={EROSION_RADIUS}px")
    print("[INFO] Pressione Ctrl+C para encerrar.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[INFO] Tile server encerrado.")
