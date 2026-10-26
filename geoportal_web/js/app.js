/**
 * Geoportal Oficial de Matinhos - Script Principal
 * Secretaria Municipal de Urbanismo e Planejamento Urbano - Prefeitura de Matinhos
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
let measureRedoPoints = [];
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
        2: { layer: null, key: 'ortofoto',  zIndex: 2 }
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

        const sel = document.getElementById('basemap-select-' + slot);
        if (sel && sel.value !== key) {
            sel.value = key;
        }

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

    // Inicializar: carregar slot 1 com Google Satélite e slot 2 com Ortofoto sobreposta
    setBasemap(1, 'googleSat');
    setBasemap(2, 'ortofoto');

    function syncBasemapPresetHighlight() {
        const k1 = basemapState[1].key;
        const k2 = basemapState[2].key;
        const op2 = document.getElementById('basemap-opacity-2') ? parseInt(document.getElementById('basemap-opacity-2').value, 10) : 100;
        let activePreset = '';
        if (k1 === 'googleSat' && k2 === 'ortofoto' && op2 >= 95) activePreset = 'ortho_sat';
        else if (k1 === 'googleSat' && k2 === 'ortofoto' && op2 >= 40 && op2 <= 60) activePreset = 'compare_50';
        else if (k1 === 'googleSat' && k2 === 'none') activePreset = 'sat_only';
        else if (k1 === 'osm' && k2 === 'none') activePreset = 'osm_only';

        document.querySelectorAll('.bm-preset-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-bm-preset') === activePreset);
        });
    }

    function applyBasemapPreset(preset) {
        const s1 = document.getElementById('basemap-opacity-1');
        const v1 = document.getElementById('basemap-opacity-1-val');
        const s2 = document.getElementById('basemap-opacity-2');
        const v2 = document.getElementById('basemap-opacity-2-val');

        // Garantir ordem padrão (Base = 1, Sobreposta = 2)
        basemapState[1].zIndex = 1;
        basemapState[2].zIndex = 2;

        if (s1 && v1) { s1.value = 100; v1.textContent = '100%'; }

        if (preset === 'ortho_sat') {
            if (s2 && v2) { s2.value = 100; v2.textContent = '100%'; }
            setBasemap(1, 'googleSat');
            setBasemap(2, 'ortofoto');
        } else if (preset === 'compare_50') {
            if (s2 && v2) { s2.value = 50; v2.textContent = '50%'; }
            setBasemap(1, 'googleSat');
            setBasemap(2, 'ortofoto');
            if (basemapState[2].layer) basemapState[2].layer.setOpacity(0.5);
        } else if (preset === 'sat_only') {
            if (s2 && v2) { s2.value = 100; v2.textContent = '100%'; }
            setBasemap(1, 'googleSat');
            setBasemap(2, 'none');
        } else if (preset === 'osm_only') {
            if (s2 && v2) { s2.value = 100; v2.textContent = '100%'; }
            setBasemap(1, 'osm');
            setBasemap(2, 'none');
        }
        syncBasemapPresetHighlight();
    }

    // Eventos dos selects, sliders e presets de basemap
    function setupBasemapControls() {
        [1, 2].forEach(slot => {
            const sel = document.getElementById(`basemap-select-${slot}`);
            const slider = document.getElementById(`basemap-opacity-${slot}`);
            const valLabel = document.getElementById(`basemap-opacity-${slot}-val`);

            if (sel) {
                sel.addEventListener('change', () => {
                    setBasemap(slot, sel.value);
                    syncBasemapPresetHighlight();
                });
            }
            if (slider && valLabel) {
                slider.addEventListener('input', () => {
                    const pct = parseInt(slider.value);
                    valLabel.textContent = pct + '%';
                    if (basemapState[slot].layer) {
                        basemapState[slot].layer.setOpacity(pct / 100);
                    }
                    syncBasemapPresetHighlight();
                });
            }
        });

        document.querySelectorAll('.bm-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                applyBasemapPreset(btn.getAttribute('data-bm-preset'));
            });
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

    // Controle da Gaveta Flutuante de Camadas e Legendas (Inicia Oculta)
    const sidebar = document.getElementById('sidebar');
    const floatingLayersBtn = document.getElementById('floating-layers-btn');
    const btnCloseSidebar = document.getElementById('btn-close-sidebar');

    function openLayersPanel() {
        sidebar.classList.remove('collapsed');
        const tabCamadasBtn = document.getElementById('tab-btn-camadas');
        if (tabCamadasBtn) tabCamadasBtn.click();
    }

    function closeSidebar() {
        sidebar.classList.add('collapsed');
    }

    function toggleLayersPanel() {
        if (sidebar.classList.contains('collapsed')) {
            openLayersPanel();
        } else {
            closeSidebar();
        }
    }

    if (floatingLayersBtn) {
        floatingLayersBtn.addEventListener('click', toggleLayersPanel);
    }
    if (btnCloseSidebar) {
        btnCloseSidebar.addEventListener('click', closeSidebar);
    }

    const brandHome = document.getElementById('brand-home');
    if (brandHome) {
        brandHome.addEventListener('click', () => {
            map.flyTo(INITIAL_CENTER, INITIAL_ZOOM, { duration: 1.2 });
        });
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

    // Filtro de Zonas no Select e Botão Reset
    const zoneFilterSelect = document.getElementById('zone-filter-select');
    const btnResetZoneFilter = document.getElementById('btn-reset-zone-filter');
    zoneFilterSelect.addEventListener('change', (e) => {
        applyZoneFilter(e.target.value, true);
    });
    if (btnResetZoneFilter) {
        btnResetZoneFilter.addEventListener('click', () => {
            applyZoneFilter('ALL', false);
        });
    }

    // Botões de Enquadrar Camada no Mapa (Lupa)
    document.querySelectorAll('.btn-zoom-layer').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const layerId = btn.getAttribute('data-zoom-layer');
            zoomToThematicLayer(layerId);
        });
    });

    // Filtro rápido por texto de camadas e zonas
    const layerFilterInput = document.getElementById('layer-filter-input');
    const layerFilterClear = document.getElementById('layer-filter-clear');
    if (layerFilterInput) {
        const runLayerFilter = () => {
            const raw = layerFilterInput.value.trim();
            if (layerFilterClear) layerFilterClear.style.display = raw ? 'block' : 'none';
            const q = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

            document.querySelectorAll('#tab-camadas .layer-group').forEach(group => {
                const items = group.querySelectorAll('.layer-item');
                let anyMatch = false;
                items.forEach(item => {
                    const txt = (item.textContent || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                    const match = !q || txt.includes(q);
                    item.style.display = match ? 'flex' : 'none';
                    if (match) anyMatch = true;
                });

                // Se for o grupo de zoneamento, filtrar também os itens da legenda de zonas
                if (group.getAttribute('data-group-container') === 'group-zoneamento') {
                    const zItems = group.querySelectorAll('.zone-legend-item');
                    let anyZoneMatch = false;
                    zItems.forEach(zi => {
                        const zTxt = (zi.textContent || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                        const zMatch = !q || zTxt.includes(q);
                        zi.style.display = zMatch ? 'flex' : 'none';
                        if (zMatch) anyZoneMatch = true;
                    });
                    if (anyZoneMatch) {
                        anyMatch = true;
                        const mainZoneRow = group.querySelector('[data-layer-row="zoneamento_corrigido"]');
                        if (mainZoneRow) mainZoneRow.style.display = 'flex';
                    }
                }

                group.style.display = anyMatch ? 'block' : 'none';
                if (q && anyMatch) {
                    const content = group.querySelector('.group-content');
                    const icon = group.querySelector('.toggle-icon');
                    if (content) content.style.display = 'block';
                    if (icon) icon.className = 'fa-solid fa-chevron-down toggle-icon';
                }
            });
        };
        layerFilterInput.addEventListener('input', runLayerFilter);
        if (layerFilterClear) {
            layerFilterClear.addEventListener('click', () => {
                layerFilterInput.value = '';
                runLayerFilter();
                layerFilterInput.focus();
            });
        }
    }

    // Atualizar contadores sempre que qualquer checkbox de camada mudar
    const tabCamadas = document.getElementById('tab-camadas');
    if (tabCamadas) {
        tabCamadas.addEventListener('change', (e) => {
            if (e.target && e.target.type === 'checkbox') {
                updateLayerCounters();
            }
        });
    }
    updateLayerCounters();

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
    const btnMeasureUndo = document.getElementById('btn-measure-undo');
    if (btnMeasureUndo) btnMeasureUndo.addEventListener('click', undoMeasure);
    const btnMeasureRedo = document.getElementById('btn-measure-redo');
    if (btnMeasureRedo) btnMeasureRedo.addEventListener('click', redoMeasure);

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
            opt.textContent = `${z.badge} — ${z.label}`;
            filterSelect.appendChild(opt);

            // Item interativo na legenda da sidebar (clique isola a zona no mapa!)
            const legItem = document.createElement('div');
            legItem.className = 'zone-legend-item';
            legItem.setAttribute('data-zone-key', zk);
            legItem.title = `${z.desc} (Clique para ativar e isolar no mapa)`;
            legItem.innerHTML = `
                <div class="zone-legend-left">
                    <span class="zone-legend-code" style="background: ${z.color};">${z.badge}</span>
                    <span class="zone-legend-name">${z.label}</span>
                </div>
                <span class="zone-legend-action">Isolar</span>
            `;
            legItem.addEventListener('click', () => {
                const nextZone = (currentZoneFilter === zk) ? 'ALL' : zk;
                applyZoneFilter(nextZone, nextZone !== 'ALL');
            });
            legendList.appendChild(legItem);

            // Card interativo na aba Guia de Zonas
            const statCard = document.createElement('div');
            statCard.className = 'info-card';
            statCard.style.padding = '10px';
            statCard.style.marginBottom = '8px';
            statCard.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="info-badge" style="background: ${z.color};">${z.badge}</span>
                        <b style="font-size: 0.84rem; color: var(--primary);">${z.label}</b>
                    </div>
                    <button type="button" class="btn-reset-zone-filter" data-guide-zone="${zk}" title="Ativar Zoneamento e isolar esta zona no mapa">
                        <i class="fa-solid fa-magnifying-glass-location"></i> Isolar no mapa
                    </button>
                </div>
                <p style="font-size: 0.76rem; color: var(--text-muted); line-height: 1.35;">${z.desc}</p>
            `;
            const guideBtn = statCard.querySelector('[data-guide-zone]');
            if (guideBtn) {
                guideBtn.addEventListener('click', () => {
                    applyZoneFilter(zk, true);
                });
            }
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
        } else if (layerDef.type === 'labels') {
            // Rótulos fixos (nomes de ruas): marcadores de texto não interativos, visíveis a partir do zoom mínimo
            geojsonLayer = L.featureGroup();
            (geojsonData.features || []).forEach(f => {
                const nome = f.properties && f.properties.Logradouro;
                if (!nome || !f.geometry) return;
                const safe = String(nome).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
                L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], {
                    icon: L.divIcon({ className: 'street-label', html: `<span>${safe}</span>`, iconSize: null }),
                    interactive: false,
                    keyboard: false
                }).addTo(geojsonLayer);
            });
            const minZ = layerDef.min_zoom || 16;
            geojsonLayer._isLabels = true;
            geojsonLayer._minZoom = minZ;
            const toggleLabelsZoom = () => map.getContainer().classList.toggle('street-labels-hidden', map.getZoom() < minZ);
            map.on('zoomend', toggleLabelsZoom);
            toggleLabelsZoom();
        } else if (layerDef.type === 'line') {
            geojsonLayer = L.geoJSON(geojsonData, {
                style: feature => getLineFeatureStyle(feature, layerDef),
                onEachFeature: (feature, layer) => {
                    layer.layerDef = layerDef;
                    const props = feature.properties || {};
                    const nome = props.Logradouro || props.Nome;
                    if (nome) {
                        layer.bindTooltip(`<b>${nome}</b>`, { sticky: true, direction: 'top', className: 'bairro-tooltip' });
                    }
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
                updateLayerCounters();
            });
        }
        updateLayerCounters();

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
 * Estilo das camadas de linhas (Sistema Viário): categorizado por atributo ou simples
 */
function getLineFeatureStyle(feature, def) {
    if (!def.categories) {
        return { color: def.color, weight: def.weight, dashArray: def.dashArray || null, fill: false, opacity: 1 };
    }
    const v = (feature.properties || {})[def.categorized_by];
    const cat = def.categories.find(c => c.value !== null && c.value === v) || def.categories.find(c => c.value === null);
    return {
        color: cat ? cat.color : '#9ca3af',
        weight: (cat && cat.weight) || def.weight,
        dashArray: null,
        fill: false,
        opacity: 1
    };
}

/**
 * Restaura o estilo padrão de uma camada após desmarcar o destaque
 */
function resetLayerStyle(l) {
    if (!l) return;
    const def = l.layerDef;
    if (!def) return;

    if (def.type === 'line') {
        l.setStyle(getLineFeatureStyle(l.feature, def));
    } else if (def.id === 'zoneamento_corrigido') {
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

    // Camadas de linhas (Sistema Viário): título pelo logradouro e extensão no lugar da área
    const isLine = layerDef.type === 'line';
    let lineLenFormatted = '';
    if (isLine) {
        title = props.Logradouro || props.Nome || layerDef.title;
        badgeText = layerDef.title;
        badgeBg = getLineFeatureStyle(feature, layerDef).color;
        if (badgeBg === '#ffffff' || badgeBg === '#fffa72') badgeBg = '#64748b';
        const segs = feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : [feature.geometry.coordinates];
        let len = 0;
        segs.forEach(seg => {
            for (let i = 0; i < seg.length - 1; i++) {
                len += L.latLng(seg[i][1], seg[i][0]).distanceTo(L.latLng(seg[i + 1][1], seg[i + 1][0]));
            }
        });
        lineLenFormatted = len > 1000 ? `${(len / 1000).toFixed(2)} km` : `${len.toFixed(1)} m`;
    }
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
                <span class="info-label">${isLine ? 'Extensão Aproximada:' : 'Área Aproximada:'}</span>
                <span class="info-value" style="color: var(--accent-hover);">${isLine ? lineLenFormatted : areaFormatted}</span>
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
    if (!geometry) return 0;
    let polys = [];
    if (Array.isArray(geometry)) {
        polys = [[[...geometry]]];
    } else if (geometry.coordinates) {
        if (geometry.type === 'Polygon') {
            polys = [geometry.coordinates];
        } else if (geometry.type === 'MultiPolygon') {
            polys = geometry.coordinates;
        } else {
            return 0;
        }
    }
    if (!polys.length) return 0;

    let totalArea = 0;
    for (let p = 0; p < polys.length; p++) {
        const poly = polys[p];
        if (!poly || !poly.length) continue;
        for (let j = 0; j < poly.length; j++) {
            let ring = poly[j];
            if (!ring || ring.length < 3) continue;
            if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) {
                ring = ring.slice(0, -1);
            }
            const n = ring.length;
            if (n < 3) continue;

            const utm = ring.map(c => toUTM22S(c[1], c[0]));
            let ringArea = 0;
            for (let i = 0; i < n; i++) {
                const k = (i + 1) % n;
                ringArea += (utm[i].easting * utm[k].northing) - (utm[k].easting * utm[i].northing);
            }
            ringArea = Math.abs(ringArea) / 2.0;
            if (j === 0) totalArea += ringArea;
            else totalArea -= ringArea;
        }
    }
    return Math.max(0, totalArea);
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
    measureRedoPoints = [];
    measureLayerGroup.clearLayers();
    ['btn-measure-dist', 'dock-measure-dist', 'btn-measure-area', 'dock-measure-area'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });
    document.getElementById('measure-card').classList.remove('active');
}

function clearMeasure() {
    measurePoints = [];
    measureRedoPoints = [];
    measureLayerGroup.clearLayers();
    document.getElementById('measure-result').textContent = measureMode === 'distance' ? '0.00 m' : '0.00 m²';
}

function renderMeasureGraphics() {
    if (!measureLayerGroup) return;
    measureLayerGroup.clearLayers();

    if (!measureMode || measurePoints.length === 0) {
        document.getElementById('measure-result').textContent = measureMode === 'distance' ? '0.00 m' : '0.00 m²';
        return;
    }

    // Recriar todos os marcadores
    measurePoints.forEach(p => {
        L.circleMarker(p, { radius: 5, color: '#fff', fillColor: '#00a896', fillOpacity: 1, weight: 2 }).addTo(measureLayerGroup);
    });

    if (measureMode === 'distance') {
        if (measurePoints.length > 1) {
            L.polyline(measurePoints, { color: '#00a896', weight: 3, dashArray: '4, 4' }).addTo(measureLayerGroup);

            let totalDist = 0;
            for (let i = 0; i < measurePoints.length - 1; i++) {
                totalDist += measurePoints[i].distanceTo(measurePoints[i + 1]);
            }
            const formatted = totalDist > 1000 ? `${(totalDist / 1000).toFixed(2)} km` : `${totalDist.toFixed(1)} m`;
            document.getElementById('measure-result').textContent = formatted;
        } else {
            document.getElementById('measure-result').textContent = '0.00 m';
        }
    } else if (measureMode === 'area') {
        if (measurePoints.length > 2) {
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
        } else if (measurePoints.length === 2) {
            L.polyline(measurePoints, { color: '#00a896', weight: 3, dashArray: '4, 4' }).addTo(measureLayerGroup);
            const dist = measurePoints[0].distanceTo(measurePoints[1]);
            const formatted = dist > 1000 ? `${(dist / 1000).toFixed(2)} km` : `${dist.toFixed(1)} m`;
            document.getElementById('measure-result').textContent = `Comprimento: ${formatted} (adicione mais pontos)`;
        } else {
            document.getElementById('measure-result').textContent = '0.00 m²';
        }
    }
}

function undoMeasure() {
    if (!measurePoints.length) return;
    const pt = measurePoints.pop();
    measureRedoPoints.push(pt);
    renderMeasureGraphics();
}

function redoMeasure() {
    if (!measureRedoPoints.length) return;
    const pt = measureRedoPoints.pop();
    measurePoints.push(pt);
    renderMeasureGraphics();
}

function onMapMeasureClick(e) {
    if (!measureMode) return;
    measurePoints.push(e.latlng);
    measureRedoPoints = [];
    renderMeasureGraphics();
}

function onMapMeasureDblClick(e) {
    if (!measureMode) return;
    L.DomEvent.stopPropagation(e);
    document.getElementById('measure-hint').textContent = 'Medição concluída! Clique em limpar para nova medição.';
}


/**
 * Atualiza os contadores de camadas ativas no botão flutuante, no cabeçalho e em cada grupo
 */
function updateLayerCounters() {
    const allCbs = document.querySelectorAll('#tab-camadas .group-content input[type="checkbox"]');
    let totalActive = 0;
    allCbs.forEach(cb => {
        if (cb.checked) totalActive++;
    });

    const labelText = totalActive === 1 ? '1 ativa' : `${totalActive} ativas`;
    const floatBadge = document.getElementById('floating-layers-badge');
    if (floatBadge) {
        floatBadge.textContent = labelText;
        floatBadge.classList.toggle('has-active', totalActive > 0);
    }

    const sideBadge = document.getElementById('sidebar-active-badge');
    if (sideBadge) {
        sideBadge.textContent = labelText;
        sideBadge.classList.toggle('has-active', totalActive > 0);
    }

    const groupIds = ['group-zoneamento', 'group-admin', 'group-preservacao', 'group-ambiental', 'group-publicos', 'group-viario'];
    groupIds.forEach(gid => {
        const container = document.getElementById(gid);
        const pill = document.getElementById('count-' + gid);
        if (container && pill) {
            const cbs = container.querySelectorAll('input[type="checkbox"]');
            let act = 0;
            cbs.forEach(c => { if (c.checked) act++; });
            pill.textContent = `${act}/${cbs.length}`;
            pill.classList.toggle('active-group', act > 0);
        }
    });
}
window.updateLayerCounters = updateLayerCounters;

/**
 * Verifica se o bounding box está dentro da região válida de Matinhos / Litoral do PR
 * (evita que feições espúrias de legenda CAD fora do município distorçam o enquadramento)
 */
function isValidMatinhosBounds(b) {
    if (!b || !b.isValid()) return false;
    const sw = b.getSouthWest();
    const ne = b.getNorthEast();
    return sw.lat >= -26.2 && ne.lat <= -25.3 && sw.lng >= -49.0 && ne.lng <= -48.0;
}

/**
 * Liga (se desligada) e enquadra uma camada temática no mapa
 */
function zoomToThematicLayer(layerId) {
    const g = layersMap[layerId];
    const cb = document.getElementById('layer-' + layerId);
    if (cb && !cb.checked) {
        cb.checked = true;
        cb.dispatchEvent(new Event('change'));
    }
    if (g) {
        if (g._isLabels) {
            // Rótulos só aparecem a partir de um zoom mínimo: aproxima o mapa sem mudar o centro
            if (map.getZoom() < g._minZoom) map.setZoom(g._minZoom);
            if (window.GeoTools) GeoTools.toast('Camada ativada! Os rótulos aparecem a partir do zoom ' + g._minZoom + '.', 'ok', 2500);
            return;
        }
        let bounds = null;
        if (g.eachLayer) {
            g.eachLayer(l => {
                if (l.getBounds) {
                    const b = l.getBounds();
                    if (isValidMatinhosBounds(b)) {
                        bounds = bounds ? bounds.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
                    }
                }
            });
        } else if (g.getBounds && isValidMatinhosBounds(g.getBounds())) {
            bounds = g.getBounds();
        }
        if (bounds && bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
            if (window.GeoTools) GeoTools.toast('Camada ativada e enquadrada no mapa!', 'ok', 2000);
        }
    }
}

/**
 * Aplica filtro de zona específica (ativando automaticamente a camada de Zoneamento se estiver desligada)
 */
function applyZoneFilter(zoneKey, shouldZoom) {
    currentZoneFilter = zoneKey || 'ALL';
    const sel = document.getElementById('zone-filter-select');
    if (sel && sel.value !== currentZoneFilter) {
        sel.value = currentZoneFilter;
    }

    const resetBtn = document.getElementById('btn-reset-zone-filter');
    if (resetBtn) {
        resetBtn.style.display = currentZoneFilter === 'ALL' ? 'none' : 'inline-flex';
    }

    // Se filtrou uma zona específica e a camada de zoneamento está desligada, liga automaticamente!
    const zCb = document.getElementById('layer-zoneamento_corrigido');
    if (currentZoneFilter !== 'ALL' && zCb && !zCb.checked) {
        zCb.checked = true;
        zCb.dispatchEvent(new Event('change'));
    }

    // Atualizar destaque na legenda interativa
    document.querySelectorAll('.zone-legend-item').forEach(item => {
        const zk = item.getAttribute('data-zone-key');
        const isCurrent = (currentZoneFilter !== 'ALL' && zk === currentZoneFilter);
        item.classList.toggle('active-zone-filter', isCurrent);
        const actSpan = item.querySelector('.zone-legend-action');
        if (actSpan) {
            actSpan.textContent = isCurrent ? 'Isolada ✓' : 'Isolar';
        }
    });

    const zLayer = layersMap['zoneamento_corrigido'];
    if (zLayer) {
        zLayer.setStyle(feature => getZoneFeatureStyle(feature));

        if (shouldZoom && currentZoneFilter !== 'ALL') {
            let bounds = null;
            zLayer.eachLayer(l => {
                if (l.feature && l.feature.properties && l.feature.properties.Layer === currentZoneFilter && l.getBounds) {
                    const b = l.getBounds();
                    if (isValidMatinhosBounds(b)) {
                        bounds = bounds ? bounds.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
                    }
                }
            });
            if (bounds && bounds.isValid()) {
                map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
            }
            const zCfg = ZONE_CONFIG[currentZoneFilter];
            if (window.GeoTools && zCfg) {
                GeoTools.toast(`Zona isolada no mapa: ${zCfg.badge} — ${zCfg.label}`, 'ok', 2400);
            }
        }
    }
}
