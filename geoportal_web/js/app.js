/**
 * Geoportal Oficial de Matinhos - Script Principal
 * Secretaria Municipal de Urbanismo - Prefeitura de Matinhos
 */

document.addEventListener('DOMContentLoaded', () => {
    initGeoportal();
});

let map;
let layersMap = {};
let activeHighlight = null;
let currentOpacity = 0.65;
let currentZoneFilter = "ALL";
let measureMode = null; // 'distance' | 'area' | null
let measurePoints = [];
let measureLayerGroup = null;

const INITIAL_CENTER = [-25.8175, -48.5360];
const INITIAL_ZOOM = 13;

function initGeoportal() {
    // 1. Inicializar Mapa Leaflet
    map = L.map('map', {
        center: INITIAL_CENTER,
        zoom: INITIAL_ZOOM,
        minZoom: 10,
        maxZoom: 21,
        zoomControl: false
    });

    // Controle de zoom no canto inferior esquerdo para liberar a lateral direita
    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    // Escala cartográfica no canto inferior esquerdo
    L.control.scale({ imperial: false, metric: true, position: 'bottomleft' }).addTo(map);

    // Criar Pane dedicado para Áreas de Preservação e Drenagem para garantir sobreposição absoluta
    const presPane = map.createPane('preservacaoPane');
    presPane.style.zIndex = '650';
    presPane.style.pointerEvents = 'auto';

    // =========================================================================
    // 2. Sistema de Basemaps Duplos
    // Cada slot tem seu proprio TileLayer; zIndex determina qual fica por cima.
    // =========================================================================

    // Camada customizada para o Ortomosaico: remove via Canvas o colarinho branco (RGB 255,255,255)
    // e a borda de serrilhado (halo de reamostragem), deixando recorte limpo sobre imagens de satélite
    const OrthoCutoutTileLayer = L.TileLayer.extend({
        createTile: function (coords, done) {
            const tile = document.createElement('canvas');
            tile.width = 256;
            tile.height = 256;
            tile.className = 'leaflet-tile';
            const ctx = tile.getContext('2d', { willReadFrequently: true });
            const url = this.getTileUrl(coords);

            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    ctx.drawImage(img, 0, 0, 256, 256);
                    const imgData = ctx.getImageData(0, 0, 256, 256);
                    const d = imgData.data;
                    const W = 256, H = 256, N = W * H;
                    const bg = new Uint8Array(N);
                    const q = new Int32Array(N);
                    let head = 0, tail = 0;

                    const isCollarWhite = (p) => {
                        const a = d[p + 3];
                        if (a < 24) return true;
                        const r = d[p], g = d[p + 1], b = d[p + 2];
                        if (r < 240 || g < 240 || b < 240) return false;
                        const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
                        const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
                        return (mx - mn) <= 18;
                    };

                    // Semear flood-fill pelas bordas do tile e por pixels já transparentes
                    for (let i = 0; i < N; i++) {
                        const x = i & 255, y = i >> 8;
                        const p = i << 2;
                        if (d[p + 3] < 24 || ((x === 0 || x === 255 || y === 0 || y === 255) && isCollarWhite(p))) {
                            bg[i] = 1;
                            q[tail++] = i;
                        }
                    }

                    // Flood-fill 4-conectado removendo todo o fundo branco externo
                    while (head < tail) {
                        const idx = q[head++];
                        d[(idx << 2) + 3] = 0;
                        const x = idx & 255, y = idx >> 8;
                        if (x > 0) { const n = idx - 1; if (!bg[n] && isCollarWhite(n << 2)) { bg[n] = 1; q[tail++] = n; } }
                        if (x < 255) { const n = idx + 1; if (!bg[n] && isCollarWhite(n << 2)) { bg[n] = 1; q[tail++] = n; } }
                        if (y > 0) { const n = idx - 256; if (!bg[n] && isCollarWhite(n << 2)) { bg[n] = 1; q[tail++] = n; } }
                        if (y < 255) { const n = idx + 256; if (!bg[n] && isCollarWhite(n << 2)) { bg[n] = 1; q[tail++] = n; } }
                    }

                    // Passo 2: suavizar/eliminar halo esbranquiçado de 1-2px na linha de corte
                    for (let y = 0; y < H; y++) {
                        for (let x = 0; x < W; x++) {
                            const idx = (y << 8) | x;
                            if (bg[idx]) continue;
                            const hasBgNeighbor =
                                (x > 0 && bg[idx - 1]) || (x < 255 && bg[idx + 1]) ||
                                (y > 0 && bg[idx - 256]) || (y < 255 && bg[idx + 256]) ||
                                (x > 0 && y > 0 && bg[idx - 257]) || (x < 255 && y > 0 && bg[idx - 255]) ||
                                (x > 0 && y < 255 && bg[idx + 255]) || (x < 255 && y < 255 && bg[idx + 257]);
                            if (!hasBgNeighbor) continue;
                            const p = idx << 2;
                            const r = d[p], g = d[p + 1], b = d[p + 2];
                            const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
                            const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
                            if (mn >= 210 && (mx - mn) <= 26) {
                                if (mn >= 234) {
                                    d[p + 3] = 0;
                                } else {
                                    d[p + 3] = Math.round(d[p + 3] * ((234 - mn) / 24));
                                }
                            }
                        }
                    }

                    ctx.putImageData(imgData, 0, 0);
                } catch (e) { /* fallback caso CORS falhe */ }
                done(null, tile);
            };
            img.onerror = () => {
                done(null, tile);
            };
            img.src = url;
            return tile;
        }
    });

    // Fabrica de TileLayers — cria uma nova instancia para cada seleção
    const BASEMAP_DEFS = {
        googleSat: () => L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
            maxZoom: 21, maxNativeZoom: 20, attribution: '&copy; Google Satellite'
        }),
        esri: () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 21, maxNativeZoom: 19, attribution: '&copy; Esri World Imagery'
        }),
        osm: () => L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 21, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap contributors'
        }),
        topo: () => L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            maxZoom: 21, maxNativeZoom: 17, attribution: '&copy; OpenTopoMap'
        }),
        carto: () => L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 21, maxNativeZoom: 19, attribution: '&copy; CARTO Positron'
        }),
        ortofoto: () => new OrthoCutoutTileLayer('https://storage.googleapis.com/xskylab-gaia/TMS/AEROLEVANTAMENTO/2025/MATINHOS_ORTOMOSAICO_PR1/color/MATINHOS_ORTOMOSAICO_PR1.tms/{z}/{x}/{y}.png', {
            maxZoom: 21,
            maxNativeZoom: 21,
            tms: true,
            attribution: '&copy; Aerolevantamento / Ortomosaico Matinhos 2025 (PR1)',
            bounds: L.latLngBounds([-25.860, -48.575], [-25.695, -48.465])
        }),
        none: () => null
    };

    // Estado dos dois slots: { layer, key, zIndex } + satélite de fundo automático sob o recorte da ortofoto
    let orthoUnderlay = null;
    const basemapState = {
        1: { layer: null, key: 'googleSat', zIndex: 1 },
        2: { layer: null, key: 'none',      zIndex: 2 }
    };

    function syncOrthoUnderlay() {
        const needsUnderlay = (basemapState[1].key === 'ortofoto' && basemapState[2].key === 'none') ||
                              (basemapState[2].key === 'ortofoto' && basemapState[1].key === 'none');
        if (needsUnderlay && !orthoUnderlay) {
            orthoUnderlay = BASEMAP_DEFS.googleSat();
            orthoUnderlay.setZIndex(0);
            orthoUnderlay.addTo(map);
        } else if (!needsUnderlay && orthoUnderlay) {
            map.removeLayer(orthoUnderlay);
            orthoUnderlay = null;
        }
    }

    /**
     * Troca a camada de basemap no slot indicado.
     * @param {number} slot - 1 ou 2
     * @param {string} key  - chave em BASEMAP_DEFS
     */
    function setBasemap(slot, key) {
        const state = basemapState[slot];
        // Remover camada anterior
        if (state.layer) {
            map.removeLayer(state.layer);
            state.layer = null;
        }
        state.key = key;
        syncOrthoUnderlay();
        if (key === 'none') return;

        const layer = BASEMAP_DEFS[key]();
        if (!layer) return;
        layer.setZIndex(state.zIndex);
        layer.setOpacity(getBasemapOpacity(slot));
        layer.addTo(map);
        state.layer = layer;
    }

    function getBasemapOpacity(slot) {
        const el = document.getElementById(`basemap-opacity-${slot}`);
        return el ? parseInt(el.value) / 100 : 1.0;
    }

    function swapBasemapZOrder() {
        // Inverter os zIndex entre os dois slots
        const tmp = basemapState[1].zIndex;
        basemapState[1].zIndex = basemapState[2].zIndex;
        basemapState[2].zIndex = tmp;

        // Aplicar aos layers ativos
        if (basemapState[1].layer) basemapState[1].layer.setZIndex(basemapState[1].zIndex);
        if (basemapState[2].layer) basemapState[2].layer.setZIndex(basemapState[2].zIndex);

        // Feedback visual: piscar o botão
        const btn = document.getElementById('btn-swap-basemaps');
        if (btn) {
            btn.classList.add('swapped');
            setTimeout(() => btn.classList.remove('swapped'), 600);
        }
    }

    // Inicializar: carregar slot 1 com Google Satélite
    setBasemap(1, 'googleSat');
    setBasemap(2, 'none');

    // Eventos dos selects e sliders de basemap
    function setupBasemapControls() {
        [1, 2].forEach(slot => {
            const sel = document.getElementById(`basemap-select-${slot}`);
            const slider = document.getElementById(`basemap-opacity-${slot}`);
            const valLabel = document.getElementById(`basemap-opacity-${slot}-val`);

            if (sel) {
                sel.addEventListener('change', () => setBasemap(slot, sel.value));
            }
            if (slider && valLabel) {
                slider.addEventListener('input', () => {
                    const pct = parseInt(slider.value);
                    valLabel.textContent = pct + '%';
                    if (basemapState[slot].layer) {
                        basemapState[slot].layer.setOpacity(pct / 100);
                    }
                });
            }
        });

        const swapBtn = document.getElementById('btn-swap-basemaps');
        if (swapBtn) swapBtn.addEventListener('click', swapBasemapZOrder);
    }
    setupBasemapControls();

    // Grupo para medição
    measureLayerGroup = L.layerGroup().addTo(map);

    // 3. Configurar Eventos da Interface
    setupUIEvents();

    // 4. Carregar Camadas Vetoriais
    if (window.GeoTools) GeoTools.init();
    if (window.GeoAuth) GeoAuth.init();
    loadVectorLayers();
}

/**
 * Configuração dos botões e painéis da interface
 */
function setupUIEvents() {
    // Alternância de Abas da Barra Lateral
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tab');
            const content = document.getElementById(targetId);
            if (content) content.classList.add('active');
        });
    });

    // Controle da Gaveta Flutuante de Camadas (Inicia Oculta)
    const sidebar = document.getElementById('sidebar');
    const btnToggleCamadas = document.getElementById('btn-toggle-camadas');
    const floatingLayersBtn = document.getElementById('floating-layers-btn');
    const btnCloseSidebar = document.getElementById('btn-close-sidebar');

    function openLayersPanel() {
        sidebar.classList.remove('collapsed');
        if (btnToggleCamadas) btnToggleCamadas.classList.add('active');
        const tabCamadasBtn = document.getElementById('tab-btn-camadas');
        if (tabCamadasBtn) tabCamadasBtn.click();
    }

    function closeSidebar() {
        sidebar.classList.add('collapsed');
        if (btnToggleCamadas) btnToggleCamadas.classList.remove('active');
    }

    function toggleLayersPanel() {
        if (sidebar.classList.contains('collapsed')) {
            openLayersPanel();
        } else {
            closeSidebar();
        }
    }

    if (btnToggleCamadas) {
        btnToggleCamadas.addEventListener('click', toggleLayersPanel);
    }
    if (floatingLayersBtn) {
        floatingLayersBtn.addEventListener('click', openLayersPanel);
    }
    if (btnCloseSidebar) {
        btnCloseSidebar.addEventListener('click', closeSidebar);
    }

    // Fechar gaveta ao pressionar a tecla ESC
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !sidebar.classList.contains('collapsed')) {
            closeSidebar();
        }
    });

    // Alternar grupos de camadas (Accordion)
    document.querySelectorAll('.group-header').forEach(header => {
        header.addEventListener('click', () => {
            const contentId = header.getAttribute('data-toggle');
            const content = document.getElementById(contentId);
            const icon = header.querySelector('.toggle-icon');
            if (content.style.display === 'none') {
                content.style.display = 'block';
                icon.className = 'fa-solid fa-chevron-down toggle-icon';
            } else {
                content.style.display = 'none';
                icon.className = 'fa-solid fa-chevron-right toggle-icon';
            }
        });
    });

    // Slider de Opacidade do Zoneamento
    const opacitySlider = document.getElementById('opacity-slider');
    const opacityVal = document.getElementById('opacity-val');
    opacitySlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        currentOpacity = val / 100;
        opacityVal.textContent = val + '%';
        if (layersMap['zoneamento_corrigido']) {
            layersMap['zoneamento_corrigido'].setStyle(feature => getZoneFeatureStyle(feature));
        }
    });

    // Filtro de Zonas no Select
    const zoneFilterSelect = document.getElementById('zone-filter-select');
    zoneFilterSelect.addEventListener('change', (e) => {
        currentZoneFilter = e.target.value;
        if (layersMap['zoneamento_corrigido']) {
            layersMap['zoneamento_corrigido'].setStyle(feature => getZoneFeatureStyle(feature));
        }
    });

    // Coordenadas em tempo real na barra de status
    map.on('mousemove', (e) => {
        const lat = e.latlng.lat.toFixed(5);
        const lng = e.latlng.lng.toFixed(5);
        document.getElementById('coord-wgs').textContent = `${lat}, ${lng}`;
        
        const utm = toUTM22S(e.latlng.lat, e.latlng.lng);
        document.getElementById('coord-utm').textContent = `E: ${utm.x} m, N: ${utm.y} m`;
    });

    map.on('zoomend', () => {
        document.getElementById('zoom-level').textContent = map.getZoom();
    });

    // Botão Voltar para Enquadramento Geral (se presente no header)
    const btnResetView = document.getElementById('btn-reset-view');
    if (btnResetView) {
        btnResetView.addEventListener('click', () => {
            map.flyTo(INITIAL_CENTER, INITIAL_ZOOM, { duration: 1.2 });
        });
    }

    // Eventos de GPS / Minha Localização
    const btnLocate = document.getElementById('btn-locate');
    if (btnLocate) {
        btnLocate.addEventListener('click', () => {
            map.locate({ setView: true, maxZoom: 17 });
        });
    }
    map.on('locationfound', (e) => {
        L.circleMarker(e.latlng, {
            radius: 8,
            fillColor: '#00a896',
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9
        }).addTo(map).bindPopup('Você está aqui! Precisão: ' + Math.round(e.accuracy) + ' metros').openPopup();
    });
    map.on('locationerror', () => {
        if (window.GeoTools) GeoTools.toast('Não foi possível obter sua localização atual via navegador.', 'err');
        else alert('Não foi possível obter sua localização atual via navegador.');
    });

    // Botão de Impressão (se presente no header)
    const btnPrint = document.getElementById('btn-print');
    if (btnPrint) {
        btnPrint.addEventListener('click', () => {
            if (window.GeoTools) GeoTools.openPanel('print');
            else window.print();
        });
    }

    // Ferramenta de Medição de Distância e Área
    const btnDist = document.getElementById('btn-measure-dist');
    if (btnDist) btnDist.addEventListener('click', () => toggleMeasureMode('distance'));

    const btnArea = document.getElementById('btn-measure-area');
    if (btnArea) btnArea.addEventListener('click', () => toggleMeasureMode('area'));

    // Fechar medição
    document.getElementById('btn-close-measure').addEventListener('click', () => {
        stopMeasureMode();
    });
    document.getElementById('btn-clear-measure').addEventListener('click', () => {
        clearMeasure();
    });

    // Eventos do mapa para medição
    map.on('click', onMapMeasureClick);
    map.on('dblclick', onMapMeasureDblClick);

    // Ligar / desligar todas as camadas de uma vez (os interruptores individuais continuam ativos)
    function setAllLayers(state) {
        const checkboxes = document.querySelectorAll('.group-content input[type="checkbox"]');
        checkboxes.forEach(cb => {
            if (cb.checked !== state) {
                cb.checked = state;
                cb.dispatchEvent(new Event('change'));
            }
        });
        // Limpar destaque de feição selecionada ao desligar tudo
        if (!state && activeHighlight) {
            resetLayerStyle(activeHighlight);
            activeHighlight = null;
        }
    }
    document.getElementById('btn-layers-on').addEventListener('click', () => setAllLayers(true));
    document.getElementById('btn-layers-off').addEventListener('click', () => setAllLayers(false));

    // Busca rápida
    setupSearch();
}

/**
 * Carrega todas as camadas vetoriais declaradas
 */
async function loadVectorLayers() {
    try {
        const response = await fetch('data/config.json');
        const config = await response.json();
        const layers = config.layers;

        // Preencher o select de filtro de zoneamento
        const filterSelect = document.getElementById('zone-filter-select');
        const legendList = document.getElementById('zone-legend-list');
        const statsList = document.getElementById('zone-stats-container');

        // Ordenar zonas
        const zoneKeys = Object.keys(ZONE_CONFIG).sort();
        zoneKeys.forEach(zk => {
            const z = ZONE_CONFIG[zk];
            // Opção no select
            const opt = document.createElement('option');
            opt.value = zk;
            opt.textContent = zk;
            filterSelect.appendChild(opt);

            // Item na legenda da sidebar
            const legItem = document.createElement('div');
            legItem.style.display = 'flex';
            legItem.style.alignItems = 'center';
            legItem.style.gap = '6px';
            legItem.style.padding = '3px 0';
            legItem.style.fontSize = '0.78rem';
            legItem.innerHTML = `
                <span class="layer-badge" style="background: ${z.color};"></span>
                <span title="${z.desc}">${z.label}</span>
            `;
            legendList.appendChild(legItem);

            // Card na aba de estatísticas
            const statCard = document.createElement('div');
            statCard.className = 'info-card';
            statCard.style.padding = '10px';
            statCard.style.marginBottom = '8px';
            statCard.innerHTML = `
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                    <span class="info-badge" style="background: ${z.color};">${z.badge}</span>
                    <b style="font-size: 0.85rem; color: var(--primary);">${z.label}</b>
                </div>
                <p style="font-size: 0.76rem; color: var(--text-muted); line-height: 1.3;">${z.desc}</p>
            `;
            statsList.appendChild(statCard);
        });

        // Carregar cada camada
        for (const layerDef of layers) {
            loadGeoJsonLayer(layerDef);
        }
    } catch (err) {
        console.error('Erro ao carregar configuração de camadas:', err);
    }
}

/**
 * Carrega uma camada GeoJSON individual
 */
async function loadGeoJsonLayer(layerDef) {
    const layerId = layerDef.id;
    const checkbox = document.getElementById('layer-' + layerId);

    try {
        const res = await fetch('data/' + layerDef.file);
        const geojsonData = await res.json();

        let geojsonLayer;

        if (layerId === 'area_de_preservacao') {
            geojsonLayer = L.geoJSON(geojsonData, {
                pane: 'preservacaoPane',
                style: {
                    color: '#005f73',
                    weight: 2,
                    fill: true,
                    fillColor: '#0a9396',
                    fillOpacity: 0.65
                },
                onEachFeature: (feature, layer) => {
                    layer.layerDef = layerDef;
                    setupFeatureInteractions(feature, layer, layerDef);
                }
            });
        } else if (layerId === 'zoneamento_corrigido') {
            geojsonLayer = L.geoJSON(geojsonData, {
                style: feature => getZoneFeatureStyle(feature),
                onEachFeature: (feature, layer) => {
                    layer.layerDef = layerDef;
                    setupFeatureInteractions(feature, layer, layerDef);
                }
            });
        } else if (layerId === 'limite_bairros_ipm') {
            geojsonLayer = L.geoJSON(geojsonData, {
                style: {
                    color: layerDef.color,
                    weight: layerDef.weight,
                    dashArray: layerDef.dashArray,
                    fillColor: layerDef.fillColor,
                    fillOpacity: layerDef.fillOpacity
                },
                onEachFeature: (feature, layer) => {
                    layer.layerDef = layerDef;
                    const nomeBairro = feature.properties.Layer || 'Bairro';
                    layer.bindTooltip(`<b>${nomeBairro}</b>`, {
                        sticky: true,
                        direction: 'center',
                        className: 'bairro-tooltip'
                    });
                    setupFeatureInteractions(feature, layer, layerDef);
                }
            });
        } else if (layerId === 'loteamento_por_bairro') {
            geojsonLayer = L.geoJSON(geojsonData, {
                style: feature => {
                    const featColor = (feature.properties && feature.properties.color) ? feature.properties.color : '#d97706';
                    return {
                        color: '#232323',
                        weight: 0.8,
                        dashArray: null,
                        fill: true,
                        fillColor: featColor,
                        fillOpacity: 0.65
                    };
                },
                onEachFeature: (feature, layer) => {
                    layer.layerDef = layerDef;
                    const props = feature.properties || {};
                    const nomeLoteamento = props.Loteamento || 'Loteamento';
                    const cor = props.color || '#d97706';
                    const nomeBairro = props.Bairro ? `<br><span style="font-size:0.75rem; color:#444;"><i class="fa-solid fa-location-dot"></i> Bairro: ${props.Bairro}</span>` : '';
                    layer.bindTooltip(`<div style="display:flex;align-items:center;gap:6px;"><span style="width:11px;height:11px;border-radius:2px;background:${cor};display:inline-block;border:1px solid #333;flex-shrink:0;"></span><b>${nomeLoteamento}</b></div>${nomeBairro}`, {
                        sticky: true,
                        direction: 'top',
                        className: 'bairro-tooltip'
                    });
                    setupFeatureInteractions(feature, layer, layerDef);
                }
            });
        } else {
            geojsonLayer = L.geoJSON(geojsonData, {
                style: {
                    color: layerDef.color,
                    weight: layerDef.weight,
                    dashArray: layerDef.dashArray || null,
                    fill: layerDef.fill,
                    fillColor: layerDef.fillColor || layerDef.color,
                    fillOpacity: layerDef.fillOpacity || 0.4
                },
                onEachFeature: (feature, layer) => {
                    layer.layerDef = layerDef;
                    setupFeatureInteractions(feature, layer, layerDef);
                }
            });
        }

        layersMap[layerId] = geojsonLayer;

        // Adicionar ao mapa se padrão for visível
        if (layerDef.visible_default && checkbox && checkbox.checked) {
            geojsonLayer.addTo(map);
        }

        // Listener do checkbox
        if (checkbox) {
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    geojsonLayer.addTo(map);
                } else {
                    map.removeLayer(geojsonLayer);
                }
            });
        }

    } catch (err) {
        console.error(`Erro ao carregar camada ${layerId}:`, err);
    }
}

/**
 * Retorna o estilo dinâmico de cada polígono de zoneamento
 */
function getZoneFeatureStyle(feature) {
    const zoneName = feature.properties.Layer;
    const zoneCfg = ZONE_CONFIG[zoneName];
    const baseColor = zoneCfg ? zoneCfg.color : '#888888';

    if (currentZoneFilter !== "ALL" && zoneName !== currentZoneFilter) {
        return {
            color: '#aaaaaa',
            weight: 0.3,
            fillColor: '#cccccc',
            fillOpacity: 0.05
        };
    }

    return {
        color: '#222222',
        weight: 0.7,
        fillColor: baseColor,
        fillOpacity: currentOpacity
    };
}

/**
 * Restaura o estilo padrão de uma camada após desmarcar o destaque
 */
function resetLayerStyle(l) {
    if (!l) return;
    const def = l.layerDef;
    if (!def) return;

    if (def.id === 'zoneamento_corrigido') {
        l.setStyle(getZoneFeatureStyle(l.feature));
    } else if (def.id === 'area_de_preservacao') {
        l.setStyle({
            color: '#005f73',
            weight: 2,
            fill: true,
            fillColor: '#0a9396',
            fillOpacity: 0.65
        });
    } else if (def.id === 'limite_bairros_ipm') {
        l.setStyle({
            color: def.color,
            weight: def.weight,
            dashArray: def.dashArray,
            fillColor: def.fillColor,
            fillOpacity: def.fillOpacity
        });
    } else if (def.id === 'loteamento_por_bairro') {
        const featColor = (l.feature && l.feature.properties && l.feature.properties.color) ? l.feature.properties.color : '#d97706';
        l.setStyle({
            color: '#232323',
            weight: 0.8,
            dashArray: null,
            fill: true,
            fillColor: featColor,
            fillOpacity: 0.65
        });
    } else {
        l.setStyle({
            color: def.color,
            weight: def.weight,
            dashArray: def.dashArray || null,
            fill: def.fill,
            fillColor: def.fillColor || def.color,
            fillOpacity: def.fillOpacity || 0.4
        });
    }
}

/**
 * Configura eventos de clique e hover nas feições
 */
function setupFeatureInteractions(feature, layer, layerDef) {
    layer.on('mouseover', (e) => {
        if (measureMode || window.GEO_TOOL_BUSY) return;
        const l = e.target;
        // Destaque suave na borda sem alterar z-index nem sobrepor camadas
        if (activeHighlight !== l) {
            l.setStyle({
                weight: Math.max(2, (layerDef.weight || 1) + 1),
                color: '#0077b6'
            });
        }
    });

    layer.on('mouseout', (e) => {
        if (measureMode || window.GEO_TOOL_BUSY) return;
        const l = e.target;
        if (activeHighlight === l) return;
        resetLayerStyle(l);
    });

    layer.on('click', (e) => {
        if (measureMode || window.GEO_TOOL_BUSY) return;
        L.DomEvent.stopPropagation(e);

        // Remover destaque anterior suavemente
        if (activeHighlight && activeHighlight !== layer) {
            resetLayerStyle(activeHighlight);
        }

        // Destaque suave sem sobrepor os outros:
        // Mantém as cores e opacidades naturais sem chamar bringToFront
        activeHighlight = layer;
        layer.setStyle({
            weight: 2.6,
            color: '#023e8a',
            dashArray: null
        });

        // Mostrar detalhes e identificação dos atributos na Aba de Consulta
        displayFeatureDetails(feature, layerDef, e.latlng);
    });
}

/**
 * Exibe as informações detalhadas no painel lateral
 */
function displayFeatureDetails(feature, layerDef, latlng) {
    const placeholder = document.getElementById('info-placeholder');
    const detailsContainer = document.getElementById('info-details');
    const tabBtnConsulta = document.getElementById('tab-btn-consulta');
    const sidebar = document.getElementById('sidebar');

    // Abrir a gaveta lateral se estiver oculta e ativar a aba de detalhes
    if (sidebar) sidebar.classList.remove('collapsed');
    if (tabBtnConsulta) tabBtnConsulta.click();

    placeholder.style.display = 'none';
    detailsContainer.style.display = 'block';

    const props = feature.properties || {};
    let title = layerDef.title;
    let badgeText = layerDef.title;
    let badgeBg = layerDef.color || '#0d3b66';
    let zoneDesc = "";

    if (layerDef.id === 'zoneamento_corrigido') {
        const zName = props.Layer || 'Zoneamento';
        const zCfg = ZONE_CONFIG[zName];
        title = zName;
        badgeText = zCfg ? zCfg.badge : 'Zona';
        badgeBg = zCfg ? zCfg.color : '#72075e';
        zoneDesc = zCfg ? zCfg.desc : '';
    } else if (layerDef.id === 'limite_bairros_ipm') {
        title = props.Layer || 'Bairro';
        badgeText = 'Bairro / Balneário';
        badgeBg = '#1f78b4';
    } else if (layerDef.id === 'loteamento_por_bairro') {
        title = props.Loteamento || 'Loteamento';
        badgeText = 'Loteamento';
        badgeBg = props.color || '#d97706';
        if (props.Bairro) {
            zoneDesc = `Loteamento urbano cadastrado no bairro/balneário: <b>${props.Bairro}</b>`;
        }
    }

    // Calcular área e perímetro aproximados
    const areaM2 = calculateApproxArea(feature.geometry);
    const areaHa = (areaM2 / 10000).toFixed(2);
    const areaFormatted = areaM2 > 10000 
        ? `${areaHa} ha (${areaM2.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m²)`
        : `${areaM2.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m²`;

    let utmInfo = { x: '--', y: '--', zone: '22S' };
    if (latlng) {
        utmInfo = toUTM22S(latlng.lat, latlng.lng);
    }

    let html = `
        <div class="info-card">
            <div class="info-card-header">
                <span class="info-badge" style="background: ${badgeBg};">${badgeText}</span>
                <b style="font-size: 0.95rem; color: var(--primary);">${title}</b>
            </div>
            ${zoneDesc ? `<p style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.75rem; line-height: 1.4;">${zoneDesc}</p>` : ''}
            
            <div class="info-row">
                <span class="info-label">Camada:</span>
                <span class="info-value">${layerDef.title}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Área Aproximada:</span>
                <span class="info-value" style="color: var(--accent-hover);">${areaFormatted}</span>
            </div>
            ${latlng ? `
            <div class="info-row">
                <span class="info-label">Ponto Consultado:</span>
                <span class="info-value">${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}</span>
            </div>
            <div class="info-row">
                <span class="info-label">UTM 22S (SIRGAS):</span>
                <span class="info-value">E: ${utmInfo.x} | N: ${utmInfo.y}</span>
            </div>
            ` : ''}
        </div>

        <div class="info-card">
            <b style="font-size: 0.82rem; color: var(--primary); display: block; margin-bottom: 6px;">
                <i class="fa-solid fa-list-check"></i> Atributos da Feição
            </b>
            <div style="max-height: 200px; overflow-y: auto;">
    `;

    // Listar outros atributos úteis
    let attrCount = 0;
    for (const [k, v] of Object.entries(props)) {
        if (v === null || v === '' || k === 'Shape_Leng' || k === 'Shape_Le_1' || k === 'drn_pk' || k === 'drn_pk_2') continue;
        html += `
            <div class="info-row">
                <span class="info-label">${k}:</span>
                <span class="info-value">${v}</span>
            </div>
        `;
        attrCount++;
    }
    if (attrCount === 0) {
        html += `<p style="font-size: 0.75rem; color: var(--text-muted);">Sem atributos adicionais cadastrados.</p>`;
    }

    html += `
            </div>
        </div>
    `;

    detailsContainer.innerHTML = html;
    if (window.GeoTools) GeoTools.afterDetails(feature, layerDef, latlng, detailsContainer);
}

/**
 * Cálculo geodésico simples de área para polígonos
 */
function calculateApproxArea(geometry) {
    if (!geometry || !geometry.coordinates) return 0;
    const coords = geometry.type === 'MultiPolygon' 
        ? geometry.coordinates[0][0] 
        : (geometry.type === 'Polygon' ? geometry.coordinates[0] : []);
    
    if (coords.length < 3) return 0;

    let area = 0;
    const rad = Math.PI / 180;
    for (let i = 0; i < coords.length - 1; i++) {
        const p1 = coords[i];
        const p2 = coords[i + 1];
        area += (p2[0] - p1[0]) * rad * (2 + Math.sin(p1[1] * rad) + Math.sin(p2[1] * rad));
    }
    area = area * 6378137.0 * 6378137.0 / 2.0;
    return Math.abs(area);
}

/**
 * Busca de bairros, zonas e balneários
 */
function setupSearch() {
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');

    searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        if (q.length < 2) {
            searchResults.style.display = 'none';
            searchResults.innerHTML = '';
            return;
        }

        const matches = [];

        // Buscar nos bairros
        if (layersMap['limite_bairros_ipm']) {
            layersMap['limite_bairros_ipm'].eachLayer(layer => {
                const bName = (layer.feature.properties.Layer || '').toLowerCase();
                if (bName.includes(q)) {
                    matches.push({
                        title: layer.feature.properties.Layer,
                        type: 'Bairro/Balneário',
                        layer: layer
                    });
                }
            });
        }

        // Buscar nas zonas
        Object.keys(ZONE_CONFIG).forEach(zk => {
            if (zk.toLowerCase().includes(q)) {
                matches.push({
                    title: zk,
                    type: 'Zona de Uso',
                    zoneKey: zk
                });
            }
        });

        // Buscar em loteamentos
        if (layersMap['loteamento_por_bairro']) {
            layersMap['loteamento_por_bairro'].eachLayer(layer => {
                const props = layer.feature.properties || {};
                const lName = (props.Loteamento || '').toLowerCase();
                const bName = (props.Bairro || '').toLowerCase();
                if (lName.includes(q) || (bName && bName.includes(q))) {
                    matches.push({
                        title: props.Loteamento,
                        type: props.Bairro ? `Loteamento (${props.Bairro})` : 'Loteamento',
                        layer: layer,
                        layerId: 'loteamento_por_bairro'
                    });
                }
            });
        }

        // Buscar em parques
        [
            'parque_saint_hilaire', 'parque_estadual_riodaonca', 'parque_municipal_morrodoboi',
            'parque_municipal_praiagrande', 'parque_municipal_sambaqui', 'parque_municipal_sertaozinho',
            'parque_municipal_tabuleiro'
        ].forEach(pid => {
            if (layersMap[pid]) {
                layersMap[pid].eachLayer(layer => {
                    const pName = (layer.feature.properties.nome || layer.feature.properties.Layer || pid).toLowerCase();
                    if (pName.includes(q) || pid.includes(q)) {
                        matches.push({
                            title: layer.feature.properties.nome || layer.feature.properties.Layer || pid,
                            type: 'Unidade de Conservação',
                            layer: layer
                        });
                    }
                });
            }
        });

        if (matches.length === 0) {
            searchResults.innerHTML = `<div class="search-item" style="color: var(--text-muted);">Nenhum resultado encontrado</div>`;
            searchResults.style.display = 'block';
            return;
        }

        searchResults.innerHTML = '';
        matches.slice(0, 8).forEach(m => {
            const div = document.createElement('div');
            div.className = 'search-item';
            div.innerHTML = `
                <span>${m.title}</span>
                <span class="search-item-type">${m.type}</span>
            `;
            div.addEventListener('click', () => {
                searchResults.style.display = 'none';
                searchInput.value = m.title;

                if (m.zoneKey) {
                    // Abrir painel de camadas e filtrar zona
                    if (sidebar) sidebar.classList.remove('collapsed');
                    const tabCamadasBtn = document.getElementById('tab-btn-camadas');
                    if (tabCamadasBtn) tabCamadasBtn.click();
                    const select = document.getElementById('zone-filter-select');
                    select.value = m.zoneKey;
                    select.dispatchEvent(new Event('change'));
                } else if (m.layer) {
                    if (m.layerId && layersMap[m.layerId] && !map.hasLayer(layersMap[m.layerId])) {
                        layersMap[m.layerId].addTo(map);
                        const cb = document.getElementById('layer-' + m.layerId);
                        if (cb) cb.checked = true;
                    }
                    const bounds = m.layer.getBounds();
                    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
                    m.layer.fire('click');
                }
            });
            searchResults.appendChild(div);
        });
        searchResults.style.display = 'block';
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.style.display = 'none';
        }
    });
}

/**
 * Alternar ferramenta de medição
 */
function toggleMeasureMode(mode) {
    if (measureMode === mode) {
        stopMeasureMode();
        return;
    }

    measureMode = mode;
    measurePoints = [];
    measureLayerGroup.clearLayers();

    ['btn-measure-dist', 'dock-measure-dist'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active', mode === 'distance');
    });
    ['btn-measure-area', 'dock-measure-area'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active', mode === 'area');
    });

    const card = document.getElementById('measure-card');
    card.classList.add('active');

    document.getElementById('measure-mode-title').textContent = mode === 'distance' ? 'Medir Distância' : 'Medir Área e Perímetro';
    document.getElementById('measure-result').textContent = mode === 'distance' ? '0.00 m' : '0.00 m²';
    document.getElementById('measure-hint').textContent = 'Clique no mapa para adicionar pontos. Duplo clique para encerrar.';
}

function stopMeasureMode() {
    measureMode = null;
    measurePoints = [];
    measureLayerGroup.clearLayers();
    ['btn-measure-dist', 'dock-measure-dist', 'btn-measure-area', 'dock-measure-area'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });
    document.getElementById('measure-card').classList.remove('active');
}

function clearMeasure() {
    measurePoints = [];
    measureLayerGroup.clearLayers();
    document.getElementById('measure-result').textContent = measureMode === 'distance' ? '0.00 m' : '0.00 m²';
}

function onMapMeasureClick(e) {
    if (!measureMode) return;

    measurePoints.push(e.latlng);

    // Adicionar marcador no vértice
    L.circleMarker(e.latlng, {
        radius: 5,
        color: '#ffffff',
        fillColor: '#00a896',
        fillOpacity: 1,
        weight: 2
    }).addTo(measureLayerGroup);

    if (measureMode === 'distance') {
        if (measurePoints.length > 1) {
            measureLayerGroup.clearLayers();
            // Recriar todos os marcadores
            measurePoints.forEach(p => {
                L.circleMarker(p, { radius: 5, color: '#fff', fillColor: '#00a896', fillOpacity: 1, weight: 2 }).addTo(measureLayerGroup);
            });
            L.polyline(measurePoints, { color: '#00a896', weight: 3, dashArray: '4, 4' }).addTo(measureLayerGroup);

            let totalDist = 0;
            for (let i = 0; i < measurePoints.length - 1; i++) {
                totalDist += measurePoints[i].distanceTo(measurePoints[i + 1]);
            }
            const formatted = totalDist > 1000 ? `${(totalDist / 1000).toFixed(2)} km` : `${totalDist.toFixed(1)} m`;
            document.getElementById('measure-result').textContent = formatted;
        }
    } else if (measureMode === 'area') {
        if (measurePoints.length > 2) {
            measureLayerGroup.clearLayers();
            measurePoints.forEach(p => {
                L.circleMarker(p, { radius: 5, color: '#fff', fillColor: '#00a896', fillOpacity: 1, weight: 2 }).addTo(measureLayerGroup);
            });
            L.polygon(measurePoints, { color: '#00a896', weight: 2, fillColor: '#00a896', fillOpacity: 0.3 }).addTo(measureLayerGroup);

            // Calcular área geodésica
            const geom = {
                type: 'Polygon',
                coordinates: [measurePoints.map(p => [p.lng, p.lat])]
            };
            const area = calculateApproxArea(geom);
            let perimeter = 0;
            for (let i = 0; i < measurePoints.length; i++) {
                perimeter += measurePoints[i].distanceTo(measurePoints[(i + 1) % measurePoints.length]);
            }
            const perFmt = perimeter > 1000 ? `${(perimeter / 1000).toFixed(2)} km` : `${perimeter.toFixed(1)} m`;
            const formatted = (area > 10000 
                ? `${(area / 10000).toFixed(2)} ha (${area.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m²)`
                : `${area.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m²`) + ` | Perímetro: ${perFmt}`;
            document.getElementById('measure-result').textContent = formatted;
        }
    }
}

function onMapMeasureDblClick(e) {
    if (!measureMode) return;
    L.DomEvent.stopPropagation(e);
    document.getElementById('measure-hint').textContent = 'Medição concluída! Clique em limpar para nova medição.';
}
