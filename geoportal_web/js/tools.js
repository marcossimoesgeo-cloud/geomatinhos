/**
 * Ferramentas de SIG do Geoportal de Matinhos
 * - Janela lateral direita unificada (Busca Avançada, Coordenadas, Medir Distância,
 *   Medir Área, Desenhar/Anotar/Exportar, Imprimir Mapa, GPS, Visão Inicial,
 *   Mini-mapa, Modo Escuro e Tela Cheia).
 * - Motor próprio de Desenho e Anotação sobre Leaflet (Linha, Polígono, Retângulo,
 *   Círculo, Marcador e Texto) sem dependência da barra oculta do Leaflet.draw.
 * - Diferenciação imediata entre Acesso Público e Servidor Municipal.
 */
const GeoTools = (() => {
    const state = {
        panel: null,
        restrictedIds: new Set(),
        restrictedGroupEl: null,
        drawnItems: null,
        drawnList: [],
        drawnRedoStack: [],
        drawSeq: 1,
        drawMode: null, // 'line' | 'polygon' | 'rect' | 'circle' | 'marker' | 'text' | null
        drawPts: [],
        drawRedoPts: [],
        drawVerts: null,
        drawPreview: null,
        drawColor: '#e63946',
        snapOn: true,
        snapMode: 'both',
        snapTol: 18,
        activeSnap: null,
        snapMarker: null,
        snapBadge: null,
        vertPick: null,
        extractGroup: null,
        extractRenderer: null,
        showVerts: true,
        vertexGroup: null,
        minimap: null,
        pickHandler: null,
        coordMarker: null,
        coordLotGroup: null,
        savedCoordLotsGroup: null,
        savedCoordLots: [],
        savedCoordSeq: 1,
        coordVertexCount: 4,
        lastLocatedLot: null,
        lastLocatedPoint: null,
        coordTab: 'lot',
        coordPickMode: null,
        coordPickPts: [],
        coordTempGroup: null,
        lastDetail: null
    };
    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const SKIP_PROPS = new Set(['fid', 'color', 'Shape_Leng', 'Shape_Le_1', 'drn_pk', 'drn_pk_2']);
    const NAME_KEYS = ['Loteamento', 'Layer', 'nome', 'Nome', 'NOME', 'name', 'Name', 'inscricao', 'Inscricao'];

    /* ---------- utilidades ---------- */
    function toast(msg, type = 'info', ms = 3500) {
        let box = $('toast-box');
        if (!box) { box = document.createElement('div'); box.id = 'toast-box'; box.className = 'toast-box'; document.body.appendChild(box); }
        const t = document.createElement('div');
        t.className = 'toast ' + type;
        t.textContent = msg;
        box.appendChild(t);
        requestAnimationFrame(() => t.classList.add('show'));
        setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
    }

    function featureName(props, def) {
        props = props || {};
        for (const k of NAME_KEYS) if (props[k] != null && String(props[k]).trim() !== '') return String(props[k]).replace(/\s+/g, ' ').trim();
        for (const [k, v] of Object.entries(props)) if (!SKIP_PROPS.has(k) && typeof v === 'string' && v.trim()) return v.trim();
        return (def && def.title) || 'Feição';
    }

    function eachFeatureLayer(cb) {
        Object.entries(layersMap).forEach(([id, group]) => {
            if (!group || !group.eachLayer) return;
            group.eachLayer(l => { if (l.feature) cb(l, id, state.restrictedIds.has(id)); });
        });
    }

    function layerTitle(l, id) { return (l.layerDef && l.layerDef.title) || id; }

    function pointInRing(x, y, ring) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
    }
    function pointInPolygon(x, y, rings) {
        if (!rings.length || !pointInRing(x, y, rings[0])) return false;
        for (let i = 1; i < rings.length; i++) if (pointInRing(x, y, rings[i])) return false;
        return true;
    }
    function pointInGeom(lat, lng, g) {
        if (!g) return false;
        if (g.type === 'Polygon') return pointInPolygon(lng, lat, g.coordinates);
        if (g.type === 'MultiPolygon') return g.coordinates.some(p => pointInPolygon(lng, lat, p));
        return false;
    }

    /** Inverso de toUTM22S (Newton com convergência sub-milimétrica < 0.1 mm). */
    function fromUTM22S(easting, northing) {
        let lat = (northing - 10000000) / 110574;
        let lon = -51 + (easting - 500000) / (111320 * Math.cos(lat * Math.PI / 180));
        for (let i = 0; i < 12; i++) {
            const u = toUTM22S(lat, lon);
            const curE = (typeof u.easting === 'number') ? u.easting : parseFloat(u.x);
            const curN = (typeof u.northing === 'number') ? u.northing : parseFloat(u.y);
            const dx = easting - curE;
            const dy = northing - curN;
            lat += dy / 110574;
            lon += dx / (111320 * Math.cos(lat * Math.PI / 180));
            if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) break;
        }
        return { lat, lng: lon };
    }

    const fmtDist = m => m >= 1000 ? (m / 1000).toFixed(3) + ' km' : m.toFixed(2) + ' m';
    const fmtArea = a => a >= 10000 
        ? `${(a / 10000).toFixed(4)} ha (${a.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} m²)` 
        : `${a.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} m²`;

    function calcPerimeter(geometry) {
        if (!geometry || !geometry.coordinates) return 0;
        let rings = [];
        if (geometry.type === 'Polygon') {
            rings = geometry.coordinates;
        } else if (geometry.type === 'MultiPolygon') {
            geometry.coordinates.forEach(poly => poly.forEach(r => rings.push(r)));
        } else if (geometry.type === 'LineString') {
            rings = [geometry.coordinates];
        } else if (geometry.type === 'MultiLineString') {
            rings = geometry.coordinates;
        }
        if (!rings.length) return 0;

        let totalP = 0;
        rings.forEach(ring => {
            if (!ring || ring.length < 2) return;
            const n = ring.length;
            const utm = ring.map(c => toUTM22S(c[1], c[0]));
            for (let i = 0; i < n - 1; i++) {
                totalP += Math.hypot(utm[i + 1].easting - utm[i].easting, utm[i + 1].northing - utm[i].northing);
            }
        });
        return totalP;
    }

    function download(name, text, mime) {
        const blob = new Blob([text], { type: mime });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    function copyText(text) {
        const done = () => toast('Copiado: ' + text, 'ok');
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => toast('Não foi possível copiar.', 'err'));
        else { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Não foi possível copiar.', 'err'); } ta.remove(); }
    }

    /* ---------- JANELA LATERAL DIREITA E PAINÉIS FLUTUANTES ---------- */
    const PANELS = {
        search: { icon: 'fa-magnifying-glass-location', label: 'Busca Avançada', title: 'Busca Avançada', build: buildSearchPanel },
        coords: { icon: 'fa-location-crosshairs', label: 'Buscar Coordenadas', title: 'Buscar Coordenadas / Localizar Lote', build: buildCoordsPanel, onClose: stopPick },
        draw:   { icon: 'fa-pen-ruler', label: 'Desenhar no Mapa', title: 'Desenhar, Anotar e Exportar', build: buildDrawPanel, onOpen: onDrawPanelOpen, onClose: stopActiveDraw },
        verts:  { icon: 'fa-vector-square', label: 'Extrair Vértices', title: 'Extrair Vértices das Camadas', build: buildVertsPanel, onOpen: fillLayerSelect, onClose: stopVertPick },
        print:  { icon: 'fa-print', label: 'Imprimir Mapa', title: 'Croqui de Impressão Interativo / PDF', build: buildPrintPanel, onOpen: onPrintPanelOpen, onClose: onPrintPanelClose }
    };

    function buildDock() {
        const wrap = document.querySelector('.main-wrapper');
        const dock = document.createElement('aside');
        dock.className = 'tools-dock';
        dock.id = 'tools-dock';

        const head = document.createElement('div');
        head.className = 'dock-header';
        head.innerHTML = `<span><i class="fa-solid fa-screwdriver-wrench"></i> Ferramentas</span>
            <button type="button" class="dock-collapse-btn" id="dock-collapse-btn" title="Recolher / Expandir barra de ferramentas">
                <i class="fa-solid fa-chevron-up"></i>
            </button>`;
        dock.appendChild(head);

        const list = document.createElement('div');
        list.className = 'dock-list';
        dock.appendChild(list);

        head.querySelector('#dock-collapse-btn').addEventListener('click', () => {
            const collapsed = dock.classList.toggle('collapsed');
            head.querySelector('#dock-collapse-btn i').className = `fa-solid fa-chevron-${collapsed ? 'down' : 'up'}`;
        });

        const btn = (id, icon, label, title, fn) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.id = id;
            b.className = 'dock-btn';
            b.title = title || label;
            b.innerHTML = `<i class="fa-solid ${icon}"></i><span>${esc(label)}</span>`;
            b.addEventListener('click', fn);
            list.appendChild(b);
            return b;
        };

        // 1. Painéis principais (Busca, Coordenadas, Desenho, Impressão)
        Object.entries(PANELS).forEach(([k, p]) => btn('dock-' + k, p.icon, p.label, p.title, () => {
            if (typeof stopMeasureMode === 'function') stopMeasureMode();
            togglePanel(k);
        }));

        list.appendChild(Object.assign(document.createElement('div'), { className: 'dock-sep' }));

        // 2. Ferramentas trazidas da barra superior (Medir Distância, Medir Área, GPS, Visão Inicial)
        btn('dock-measure-dist', 'fa-ruler', 'Medir Distância', 'Medir distância entre pontos no mapa', () => {
            closePanel();
            if (typeof toggleMeasureMode === 'function') toggleMeasureMode('distance');
        });
        btn('dock-measure-area', 'fa-draw-polygon', 'Medir Área', 'Medir área (m² / ha) e perímetro no mapa', () => {
            closePanel();
            if (typeof toggleMeasureMode === 'function') toggleMeasureMode('area');
        });
        btn('dock-locate', 'fa-crosshairs', 'Localização (GPS)', 'Encontrar minha localização atual (GPS)', () => {
            toast('Buscando sua localização GPS...', 'info', 2200);
            map.locate({ setView: true, maxZoom: 17 });
        });
        btn('dock-home', 'fa-house', 'Enquadrar Mapa', 'Voltar para o enquadramento inicial de Matinhos', () => {
            map.flyTo(INITIAL_CENTER, INITIAL_ZOOM, { duration: 1.0 });
        });

        list.appendChild(Object.assign(document.createElement('div'), { className: 'dock-sep' }));

        // 3. Visualização (Mini-mapa, Modo escuro, Tela cheia)
        btn('dock-minimap', 'fa-map', 'Mini-mapa', 'Mostrar / ocultar mini-mapa de localização', toggleMinimap);
        btn('dock-dark', 'fa-moon', 'Modo Escuro', 'Alternar entre modo claro e modo escuro', toggleDark);
        btn('dock-fullscreen', 'fa-expand', 'Tela Cheia', 'Entrar / sair da tela cheia', toggleFullscreen);

        wrap.appendChild(dock);

        const pwrap = document.createElement('div');
        pwrap.id = 'tool-panels';
        wrap.appendChild(pwrap);
    }

    function togglePanel(name) {
        if (state.panel === name) { closePanel(); return; }
        closePanel();
        const def = PANELS[name];
        let el = $('panel-' + name);
        if (!el) {
            el = document.createElement('div');
            el.id = 'panel-' + name;
            el.className = 'tool-panel';
            el.innerHTML = `<div class="tool-panel-head"><span><i class="fa-solid ${def.icon}"></i> ${def.title}</span>
                <button type="button" class="tool-panel-close" title="Fechar (Esc)"><i class="fa-solid fa-xmark"></i></button></div>
                <div class="tool-panel-body"></div>`;
            $('tool-panels').appendChild(el);
            el.querySelector('.tool-panel-close').addEventListener('click', closePanel);
            def.build(el.querySelector('.tool-panel-body'));
        }
        el.classList.add('open');
        const dockBtn = $('dock-' + name);
        if (dockBtn) dockBtn.classList.add('active');
        state.panel = name;
        if (def.onOpen) def.onOpen();
    }

    function closePanel() {
        if (!state.panel) return;
        const name = state.panel;
        const el = $('panel-' + name);
        if (el) el.classList.remove('open');
        const dockBtn = $('dock-' + name);
        if (dockBtn) dockBtn.classList.remove('active');
        if (PANELS[name].onClose) PANELS[name].onClose();
        state.panel = null;
    }

    /* ---------- BUSCA AVANÇADA ---------- */
    function buildSearchPanel(body) {
        body.innerHTML = `
            <div class="tp-row"><input type="text" id="adv-q" class="tp-input" placeholder="Inscrição, loteamento, bairro, zona, nome..." autocomplete="off"></div>
            <div class="tp-row two">
                <select id="adv-scope" class="tp-input">
                    <option value="all">Todos os campos</option>
                    <option value="Loteamento">Loteamento</option>
                    <option value="Bairro">Bairro (loteamentos)</option>
                    <option value="Layer">Zona / Bairro IPM</option>
                    <option value="nome">Nome (parques, praças...)</option>
                </select>
                <button type="button" class="tp-btn primary" id="adv-go"><i class="fa-solid fa-magnifying-glass"></i> Buscar</button>
            </div>
            <label class="tp-check"><input type="checkbox" id="adv-visible"> Somente camadas ligadas</label>
            <div id="adv-count" class="tp-hint">Digite ao menos 2 caracteres. Vários termos = todos devem aparecer.</div>
            <div id="adv-results" class="adv-results"></div>`;
        $('adv-go').addEventListener('click', runSearch);
        $('adv-q').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
        $('adv-q').addEventListener('input', () => { clearTimeout(buildSearchPanel._t); buildSearchPanel._t = setTimeout(runSearch, 250); });
        $('adv-scope').addEventListener('change', runSearch);
        $('adv-visible').addEventListener('change', runSearch);
    }

    function searchFeatures(q, scope, onlyVisible) {
        const terms = norm(q).trim().split(/\s+/).filter(Boolean);
        const out = [];
        if (!terms.length) return out;
        eachFeatureLayer((l, id, restr) => {
            if (onlyVisible && !map.hasLayer(layersMap[id])) return;
            const p = l.feature.properties || {};
            const hay = scope === 'all'
                ? norm(Object.entries(p).filter(([k]) => !SKIP_PROPS.has(k)).map(([, v]) => v).join(' '))
                : norm(p[scope]);
            if (terms.every(t => hay.includes(t))) out.push({ l, id, restr });
        });
        return out;
    }

    function runSearch() {
        const q = $('adv-q').value.trim();
        const res = $('adv-results');
        const count = $('adv-count');
        if (q.length < 2) { res.innerHTML = ''; count.textContent = 'Digite ao menos 2 caracteres. Vários termos = todos devem aparecer.'; return; }
        const found = searchFeatures(q, $('adv-scope').value, $('adv-visible').checked);
        const LIMIT = 60;
        count.textContent = found.length ? `${found.length} resultado(s)${found.length > LIMIT ? ` — mostrando os ${LIMIT} primeiros` : ''}` : 'Nenhum resultado encontrado.';
        res.innerHTML = '';
        found.slice(0, LIMIT).forEach(({ l, id, restr }) => {
            const p = l.feature.properties || {};
            const d = document.createElement('div');
            d.className = 'adv-item';
            const sub = [layerTitle(l, id), p.Bairro].filter(Boolean).join(' · ');
            d.innerHTML = `<b>${esc(featureName(p, l.layerDef))}</b><span>${restr ? '<i class="fa-solid fa-lock"></i> ' : ''}${esc(sub)}</span>`;
            d.addEventListener('click', () => goToFeature(l, id));
            res.appendChild(d);
        });
    }

    function goToFeature(l, id) {
        const g = layersMap[id];
        if (g && !map.hasLayer(g)) { g.addTo(map); const cb = $('layer-' + id); if (cb) cb.checked = true; }
        const b = l.getBounds ? l.getBounds() : L.latLngBounds([l.getLatLng(), l.getLatLng()]);
        map.fitBounds(b, { padding: [60, 60], maxZoom: 18 });
        const prev = window.GEO_TOOL_BUSY; window.GEO_TOOL_BUSY = false;
        l.fire('click', { latlng: b.getCenter() });
        window.GEO_TOOL_BUSY = prev;
    }

    /* ---------- COORDENADAS E LOCALIZADOR DE LOTE (MULTI-VÉRTICES & COMPARAÇÃO) ---------- */
    const SAVED_LOT_COLORS = ['#10b981', '#f59e0b', '#8b5cf6', '#f43f5e', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];

    function ensureCoordLotGroup() {
        if (!state.savedCoordLotsGroup) state.savedCoordLotsGroup = new L.FeatureGroup().addTo(map);
        if (!state.coordLotGroup) state.coordLotGroup = new L.FeatureGroup().addTo(map);
        if (!state.coordTempGroup) state.coordTempGroup = new L.FeatureGroup().addTo(map);
    }

    function updateCoordPlaceholders() {
        const isUtm = $('co-mode') ? $('co-mode').value === 'utm' : true;
        if ($('co-a')) $('co-a').placeholder = isUtm ? 'Este (E)  ex.: 752453,75' : 'Latitude  ex.: -25,8175';
        if ($('co-b')) $('co-b').placeholder = isUtm ? 'Norte (N)  ex.: 7153896,31' : 'Longitude  ex.: -48,536';
        const n = state.coordVertexCount || 4;
        for (let i = 1; i <= n; i++) {
            const ea = $(`co-v${i}-a`), eb = $(`co-v${i}-b`);
            if (ea) ea.placeholder = isUtm ? (i === 1 ? `Este (E) V1 ex: 752400` : `Este (E) V${i}`) : (i === 1 ? `Latitude V1 ex: -25.8175` : `Latitude V${i}`);
            if (eb) eb.placeholder = isUtm ? (i === 1 ? `Norte (N) V1 ex: 7153800` : `Norte (N) V${i}`) : (i === 1 ? `Longitude V1 ex: -48.536` : `Longitude V${i}`);
        }
        const nextLbl = $('co-next-vlabel');
        if (nextLbl) nextLbl.textContent = `V${n + 1}`;
        const btnLot = $('co-pick-lot');
        if (btnLot && state.coordPickMode !== 'lot') {
            btnLot.innerHTML = `<i class="fa-solid fa-crosshairs"></i> Capturar ${n} vértices por clique`;
        }
    }

    function readCurrentVertexInputs() {
        const vals = [];
        const n = state.coordVertexCount || 4;
        for (let i = 1; i <= n; i++) {
            const ea = $(`co-v${i}-a`), eb = $(`co-v${i}-b`);
            vals.push({
                a: ea ? ea.value : '',
                b: eb ? eb.value : ''
            });
        }
        return vals;
    }

    function renderVertexRows(preservedValues) {
        const container = $('co-vertices-list');
        if (!container) return;
        const vals = preservedValues || readCurrentVertexInputs();
        const n = state.coordVertexCount || 4;
        let html = '';
        for (let i = 1; i <= n; i++) {
            const vA = vals[i - 1] ? vals[i - 1].a : '';
            const vB = vals[i - 1] ? vals[i - 1].b : '';
            const tagClass = `v${((i - 1) % 4) + 1}`;
            const delBtn = i > 4
                ? `<button type="button" class="co-del-vbtn" data-del-v="${i}" title="Remover Vértice V${i}"><i class="fa-solid fa-xmark"></i></button>`
                : '';
            html += `
                <div class="co-vrow" data-v="${i}">
                    <span class="co-vtag ${tagClass}" title="Vértice ${i}">V${i}</span>
                    <input type="text" id="co-v${i}-a" class="tp-input co-coord-input" value="${esc(vA)}">
                    <input type="text" id="co-v${i}-b" class="tp-input co-coord-input" value="${esc(vB)}">
                    ${delBtn}
                </div>`;
        }
        container.innerHTML = html;

        container.querySelectorAll('.co-coord-input').forEach(inp => {
            inp.addEventListener('keydown', e => {
                if (e.key === 'Enter') locateLot();
            });
        });

        container.querySelectorAll('.co-del-vbtn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.getAttribute('data-del-v'), 10);
                removeVertexRow(idx);
            });
        });

        updateCoordPlaceholders();
    }

    function addVertexRow() {
        const vals = readCurrentVertexInputs();
        state.coordVertexCount = (state.coordVertexCount || 4) + 1;
        vals.push({ a: '', b: '' });
        renderVertexRows(vals);
        const newInput = $(`co-v${state.coordVertexCount}-a`);
        if (newInput) newInput.focus();
        toast(`Vértice V${state.coordVertexCount} adicionado!`, 'info', 1400);
    }

    function removeVertexRow(idx) {
        if ((state.coordVertexCount || 4) <= 4) return;
        const vals = readCurrentVertexInputs();
        vals.splice(idx - 1, 1);
        state.coordVertexCount = Math.max(4, vals.length);
        renderVertexRows(vals);
        toast(`Vértice V${idx} removido. Total: ${state.coordVertexCount} vértices.`, 'info', 1400);
    }

    function setVertexRowCount(count, valuesArray) {
        state.coordVertexCount = Math.max(4, count);
        renderVertexRows(valuesArray || []);
    }

    function parsePastedCoords(raw) {
        if (!raw || !raw.trim()) return null;
        let text = raw.replace(/[vV]\d+[:\s]*/g, ' ')
                      .replace(/[pP]\d+[:\s]*/g, ' ')
                      .replace(/[eE][:\s=]+/g, ' ')
                      .replace(/[nN][:\s=]+/g, ' ')
                      .replace(/[xX][:\s=]+/g, ' ')
                      .replace(/[yY][:\s=]+/g, ' ')
                      .replace(/[lL]at(itude)?[:\s=]+/gi, ' ')
                      .replace(/[lL]on(gitude)?[:\s=]+/gi, ' ');
        text = text.replace(/(\d+),(\d+)/g, '$1.$2');
        const matches = text.match(/-?\d+(?:\.\d+)?/g);
        if (!matches || matches.length < 6) return null;
        const nums = matches.map(Number);
        const pairCount = Math.floor(nums.length / 2);
        const pairs = [];
        for (let i = 0; i < pairCount; i++) {
            pairs.push({ a: nums[i * 2], b: nums[i * 2 + 1] });
        }
        if (pairs.length > 4) {
            const first = pairs[0], last = pairs[pairs.length - 1];
            if (Math.abs(first.a - last.a) < 1e-6 && Math.abs(first.b - last.b) < 1e-6) {
                pairs.pop();
            }
        }
        return pairs;
    }

    function identifyLotCadastre(center) {
        const matches = [];
        if (typeof layersMap !== 'undefined' && layersMap) {
            ['loteamento_por_bairro', 'zoneamento_corrigido', 'limite_bairros_ipm'].forEach(id => {
                const group = layersMap[id];
                if (!group || !group.eachLayer) return;
                group.eachLayer(l => {
                    if (l.feature && l.feature.geometry) {
                        if (pointInGeom(center.lat, center.lng, l.feature.geometry)) {
                            const p = l.feature.properties || {};
                            const n = featureName(p, l.layerDef);
                            matches.push({ id, title: layerTitle(l, id), name: n, p });
                        }
                    }
                });
            });
        }
        return matches;
    }

    function buildCoordsPanel(body) {
        state.coordVertexCount = state.coordVertexCount || 4;
        body.innerHTML = `
            <div class="tp-sub" style="margin-top:0;">Localizar por Coordenadas</div>
            <div class="co-tabs">
                <button type="button" class="co-tab active" data-tab="lot" id="tab-co-lot"><i class="fa-solid fa-draw-polygon"></i> 4 Vértices (Lote)</button>
                <button type="button" class="co-tab" data-tab="single" id="tab-co-single"><i class="fa-solid fa-location-dot"></i> Ponto Único</button>
            </div>

            <div class="tp-row" style="margin-top:6px;margin-bottom:6px;">
                <select id="co-mode" class="tp-input">
                    <option value="utm" selected>UTM 22S SIRGAS 2000 (Este E, Norte N)</option>
                    <option value="dd">Graus decimais (Latitude, Longitude)</option>
                </select>
            </div>

            <!-- MODO VÉRTICES / LOTE -->
            <div id="co-lot-box">
                <div style="display:flex; justify-content:space-between; align-items:center; margin:4px 0 6px;">
                    <span class="tp-hint" style="margin:0;">Vértices do lote (em ordem do perímetro):</span>
                    <button type="button" class="co-paste-btn" id="co-toggle-paste" title="Colar memorial descritivo ou lista de coordenadas">
                        <i class="fa-regular fa-paste"></i> Colar lista / Memorial
                    </button>
                </div>

                <div id="co-paste-panel" class="co-paste-wrap" style="display:none;">
                    <textarea id="co-paste-text" class="co-paste-area" placeholder="Cole aqui as coordenadas do memorial descritivo, Word ou Excel (4 ou mais pares de coordenadas E/N ou Lat/Lon)..."></textarea>
                    <div class="tp-row two" style="margin-top:6px; margin-bottom:0;">
                        <button type="button" class="tp-btn primary" id="co-paste-apply"><i class="fa-solid fa-check"></i> Processar Texto</button>
                        <button type="button" class="tp-btn" id="co-paste-cancel">Fechar</button>
                    </div>
                </div>

                <div id="co-vertices-list"></div>

                <div class="co-add-vrow">
                    <button type="button" class="co-add-vbtn" id="co-add-vertex" title="Adicionar mais um vértice conforme necessidade técnica de análise">
                        <span class="co-plus-badge"><i class="fa-solid fa-plus"></i></span> Adicionar Vértice (<span id="co-next-vlabel">V5</span>)
                    </button>
                </div>

                <div class="tp-row two" style="margin-top:8px;">
                    <button type="button" class="tp-btn primary" id="co-go-lot"><i class="fa-solid fa-map-location-dot"></i> Localizar Lote</button>
                    <button type="button" class="tp-btn" id="co-clear-inputs"><i class="fa-solid fa-eraser"></i> Limpar</button>
                </div>

                <div class="tp-sub">Capturar no mapa</div>
                <div class="tp-row">
                    <button type="button" class="tp-btn" id="co-pick-lot"><i class="fa-solid fa-crosshairs"></i> Capturar 4 vértices por clique</button>
                </div>
            </div>

            <!-- MODO PONTO ÚNICO -->
            <div id="co-single-box" style="display:none;">
                <div class="tp-row two">
                    <input type="text" id="co-a" class="tp-input" placeholder="Este (E)  ex.: 752453,75">
                    <input type="text" id="co-b" class="tp-input" placeholder="Norte (N)  ex.: 7153896,31">
                </div>
                <div class="tp-row">
                    <button type="button" class="tp-btn primary" id="co-go"><i class="fa-solid fa-location-arrow"></i> Ir para o ponto</button>
                </div>
                <div class="tp-sub">Capturar coordenada no mapa</div>
                <div class="tp-row">
                    <button type="button" class="tp-btn" id="co-pick"><i class="fa-solid fa-crosshairs"></i> Ativar captura por clique</button>
                </div>
            </div>

            <div id="co-out" class="co-out">Nenhum lote ou coordenada localizado.</div>
            <div id="co-saved-section"></div>`;

        renderVertexRows();
        renderSavedCoordLots();

        const setTab = tab => {
            state.coordTab = tab;
            $('tab-co-lot').classList.toggle('active', tab === 'lot');
            $('tab-co-single').classList.toggle('active', tab === 'single');
            $('co-lot-box').style.display = tab === 'lot' ? 'block' : 'none';
            $('co-single-box').style.display = tab === 'single' ? 'block' : 'none';
            stopPick();
        };

        $('tab-co-lot').addEventListener('click', () => setTab('lot'));
        $('tab-co-single').addEventListener('click', () => setTab('single'));
        $('co-mode').addEventListener('change', updateCoordPlaceholders);
        $('co-add-vertex').addEventListener('click', addVertexRow);

        // Painel colar memorial
        $('co-toggle-paste').addEventListener('click', () => {
            const p = $('co-paste-panel');
            p.style.display = p.style.display === 'none' ? 'block' : 'none';
            if (p.style.display === 'block') $('co-paste-text').focus();
        });
        $('co-paste-cancel').addEventListener('click', () => { $('co-paste-panel').style.display = 'none'; });
        $('co-paste-apply').addEventListener('click', () => {
            const raw = $('co-paste-text').value;
            const parsed = parsePastedCoords(raw);
            if (!parsed || parsed.length < 3) {
                toast('Não foi possível identificar pares suficientes de coordenadas no texto colado. Verifique os valores.', 'err', 4000);
                return;
            }
            const isUtm = Math.abs(parsed[0].a) > 90 || Math.abs(parsed[0].b) > 90;
            $('co-mode').value = isUtm ? 'utm' : 'dd';
            const formattedVals = parsed.map(pt => ({ a: String(pt.a), b: String(pt.b) }));
            setVertexRowCount(Math.max(4, parsed.length), formattedVals);
            $('co-paste-panel').style.display = 'none';
            $('co-paste-text').value = '';
            toast(`${parsed.length} vértices preenchidos com sucesso!`, 'ok', 2000);
            locateLot();
        });

        $('co-clear-inputs').addEventListener('click', () => {
            const n = state.coordVertexCount || 4;
            for (let i = 1; i <= n; i++) {
                if ($(`co-v${i}-a`)) $(`co-v${i}-a`).value = '';
                if ($(`co-v${i}-b`)) $(`co-v${i}-b`).value = '';
            }
            clearCoordLot();
        });

        $('co-go-lot').addEventListener('click', locateLot);
        $('co-pick-lot').addEventListener('click', () => togglePick('lot'));
        $('co-go').addEventListener('click', goToCoord);
        ['co-a', 'co-b'].forEach(i => $(i).addEventListener('keydown', e => { if (e.key === 'Enter') goToCoord(); }));
        $('co-pick').addEventListener('click', () => togglePick('single'));

        updateCoordPlaceholders();
    }

    const num = s => parseFloat(String(s).trim().replace(/\s/g, '').replace(',', '.'));

    function locateLot() {
        const coords = [];
        const isUtm = $('co-mode').value === 'utm';
        const totalRows = state.coordVertexCount || 4;

        for (let i = 1; i <= totalRows; i++) {
            const ea = $(`co-v${i}-a`), eb = $(`co-v${i}-b`);
            if (!ea || !eb) continue;
            const rawA = ea.value.trim(), rawB = eb.value.trim();

            if (i > 4 && rawA === '' && rawB === '' && coords.length >= 3) {
                let anyLaterFilled = false;
                for (let j = i + 1; j <= totalRows; j++) {
                    const ja = $(`co-v${j}-a`), jb = $(`co-v${j}-b`);
                    if ((ja && ja.value.trim() !== '') || (jb && jb.value.trim() !== '')) {
                        anyLaterFilled = true;
                        break;
                    }
                }
                if (!anyLaterFilled) {
                    toast(`Informe as coordenadas do Vértice V${i} ou remova-o no botão (×).`, 'err');
                    ea.focus();
                    return;
                }
            }

            const a = num(rawA), b = num(rawB);
            if (!isFinite(a) || !isFinite(b)) {
                toast(`Informe as coordenadas numéricas do Vértice V${i}.`, 'err');
                ea.focus();
                return;
            }
            if (isUtm) {
                if (a < 100000 || a > 900000 || b < 6000000 || b > 8000000) {
                    toast(`Vértice V${i}: Coordenadas UTM fora da faixa de Matinhos (E 100000–900000, N 6000000–8000000).`, 'err');
                    return;
                }
                const ll = fromUTM22S(a, b);
                coords.push({ v: i, e: a, n: b, lat: ll.lat, lng: ll.lng, ll: L.latLng(ll.lat, ll.lng) });
            } else {
                if (Math.abs(a) > 90 || Math.abs(b) > 180) {
                    toast(`Vértice V${i}: Latitude (-90 a 90) ou Longitude (-180 a 180) inválida.`, 'err');
                    return;
                }
                const u = toUTM22S(a, b);
                coords.push({ v: i, e: parseFloat(u.x), n: parseFloat(u.y), lat: a, lng: b, ll: L.latLng(a, b) });
            }
        }

        if (coords.length < 3) {
            toast('Informe ao menos 3 vértices para delimitar o polígono/lote.', 'err');
            return;
        }

        const nVerts = coords.length;
        ensureCoordLotGroup();
        state.coordLotGroup.clearLayers();
        if (state.coordMarker) { state.coordMarker.remove(); state.coordMarker = null; }
        if (state.coordTempGroup) state.coordTempGroup.clearLayers();

        const pts = coords.map(c => c.ll);
        const poly = L.polygon(pts, {
            color: '#0284c7',
            weight: 3.5,
            fillColor: '#38bdf8',
            fillOpacity: 0.28
        }).addTo(state.coordLotGroup);

        // Distâncias dos N lados
        const sides = [];
        let perimeter = 0;
        for (let i = 0; i < nVerts; i++) {
            const next = (i + 1) % nVerts;
            const d = coords[i].ll.distanceTo(coords[next].ll);
            sides.push({ from: coords[i].v, to: coords[next].v, d });
            perimeter += d;

            const midLat = (coords[i].lat + coords[next].lat) / 2;
            const midLng = (coords[i].lng + coords[next].lng) / 2;
            const dimIcon = L.divIcon({
                className: 'lot-dim-wrap',
                html: `<span class="lot-dim-label">${fmtDist(d)}</span>`,
                iconSize: [0, 0]
            });
            L.marker([midLat, midLng], { icon: dimIcon, interactive: false, zIndexOffset: 2000 }).addTo(state.coordLotGroup);
        }

        // Área plana pelo Shoelace em UTM (área exata de memorial descritivo)
        let areaShoelace = 0;
        for (let i = 0; i < nVerts; i++) {
            const next = (i + 1) % nVerts;
            areaShoelace += (coords[i].e * coords[next].n) - (coords[next].e * coords[i].n);
        }
        const area = Math.abs(areaShoelace) / 2.0;

        // Vértices V1..Vn com pinos visíveis no mapa
        coords.forEach(c => {
            const pinIcon = L.divIcon({
                className: 'lot-vertex-pin-wrap',
                html: `<div class="lot-vertex-pin" title="Vértice V${c.v}"><span>V${c.v}</span></div>`,
                iconSize: [26, 26],
                iconAnchor: [13, 13]
            });
            const dd = `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`;
            const utmStr = `E ${c.e.toFixed(2)} · N ${c.n.toFixed(2)}`;
            const m = L.marker(c.ll, { icon: pinIcon, zIndexOffset: 2500 }).addTo(state.coordLotGroup);
            m.bindTooltip(`<b>Vértice V${c.v}</b><br>UTM 22S: ${utmStr}<br>Lat/Lon: ${dd}<br><small>Clique para copiar</small>`, { direction: 'top', offset: [0, -14] });
            m.on('click', () => copyText(`${c.e.toFixed(2)}, ${c.n.toFixed(2)}`));
        });

        // Enquadrar o lote no mapa
        map.fitBounds(poly.getBounds(), { padding: [55, 55], maxZoom: 19 });

        // Identificação cadastral de loteamentos/zoneamento no centro do lote
        const center = poly.getBounds().getCenter();
        const cadMatches = identifyLotCadastre(center);
        let cadHtml = '';
        if (cadMatches.length) {
            const parts = cadMatches.map(m => `<b>${esc(m.title)}:</b> ${esc(m.name)}`);
            cadHtml = `<div class="co-cad-info"><i class="fa-solid fa-circle-info"></i> ${parts.join(' · ')}</div>`;
        }

        state.lastLocatedLot = {
            coords: coords.map(c => ({ ...c })),
            pts: pts.slice(),
            area,
            perimeter,
            sides: sides.map(s => ({ ...s })),
            cadHtml
        };

        // Tabela de verificação das N coordenadas
        const out = $('co-out');
        if (out) {
            out.innerHTML = `
                <div class="co-lot-card">
                    <div class="co-lot-head">
                        <i class="fa-solid fa-draw-polygon"></i> <b>Lote Localizado (${nVerts} Vértices)</b>
                    </div>
                    <div class="co-lot-metrics">
                        <div><span>Área:</span> <b>${fmtArea(area)}</b></div>
                        <div><span>Perímetro:</span> <b>${fmtDist(perimeter)}</b></div>
                    </div>
                    ${cadHtml}
                    <div class="co-table-wrap">
                        <table class="co-table">
                            <thead>
                                <tr>
                                    <th>V</th>
                                    <th>Este (E) / Lat</th>
                                    <th>Norte (N) / Lon</th>
                                    <th>Confrontação</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${coords.map((c, i) => `<tr>
                                    <td><b style="color:#0284c7;">V${c.v}</b></td>
                                    <td>${c.e.toFixed(2)}<br><small style="color:#64748b;">${c.lat.toFixed(6)}</small></td>
                                    <td>${c.n.toFixed(2)}<br><small style="color:#64748b;">${c.lng.toFixed(6)}</small></td>
                                    <td>V${c.v}–V${sides[i].to}: <b>${fmtDist(sides[i].d)}</b></td>
                                </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div class="tp-row three" style="margin-top:8px; margin-bottom:0;">
                        <button type="button" class="tp-btn" id="co-copy-lot" title="Copiar memorial/tabela de vértices"><i class="fa-regular fa-copy"></i> Copiar</button>
                        <button type="button" class="tp-btn primary" id="co-save-lot" title="Salvar este lote e seus vértices no mapa para gerar outro e comparar"><i class="fa-solid fa-floppy-disk"></i> Salvar</button>
                        <button type="button" class="tp-btn danger" id="co-clear-lot" title="Limpar visualização atual"><i class="fa-solid fa-trash-can"></i> Limpar</button>
                    </div>
                </div>`;

            $('co-copy-lot').addEventListener('click', () => {
                const header = ['Vertice', 'UTM_E_22S', 'UTM_N_22S', 'Latitude', 'Longitude', 'Lado_Comprimento'];
                const lines = coords.map((c, i) => [`V${c.v}`, c.e.toFixed(2), c.n.toFixed(2), c.lat.toFixed(6), c.lng.toFixed(6), `${fmtDist(sides[i].d)}`]);
                const text = `LOTE LOCALIZADO (${nVerts} VÉRTICES) - GEOPORTAL DE MATINHOS\nÁrea: ${fmtArea(area)} | Perímetro: ${fmtDist(perimeter)}\n\n` + [header.join('\t')].concat(lines.map(x => x.join('\t'))).join('\n');
                copyText(text);
            });

            $('co-save-lot').addEventListener('click', saveCurrentCoordLot);
            $('co-clear-lot').addEventListener('click', clearCoordLot);
        }

        renderSavedCoordLots();
        toast(`Lote localizado com sucesso! ${nVerts} vértices destacados no mapa.`, 'ok', 2600);
    }

    function saveCurrentCoordLot() {
        if (!state.lastLocatedLot) {
            toast('Localize um lote primeiro antes de salvar.', 'err');
            return;
        }
        ensureCoordLotGroup();
        const data = state.lastLocatedLot;
        const seq = state.savedCoordSeq++;
        const color = SAVED_LOT_COLORS[(seq - 1) % SAVED_LOT_COLORS.length];
        const nVerts = data.coords.length;
        const lotName = `Lote #${seq} (${nVerts}V)`;

        const itemGroup = new L.FeatureGroup().addTo(state.savedCoordLotsGroup);

        const poly = L.polygon(data.pts, {
            color: color,
            weight: 3.5,
            fillColor: color,
            fillOpacity: 0.24
        }).addTo(itemGroup);
        poly.bindTooltip(`<b>${esc(lotName)}</b><br>Área: ${fmtArea(data.area)} · Perímetro: ${fmtDist(data.perimeter)}`, { sticky: true });

        for (let i = 0; i < nVerts; i++) {
            const next = (i + 1) % nVerts;
            const d = data.sides[i].d;
            const midLat = (data.coords[i].lat + data.coords[next].lat) / 2;
            const midLng = (data.coords[i].lng + data.coords[next].lng) / 2;
            const dimIcon = L.divIcon({
                className: 'lot-dim-wrap',
                html: `<span class="lot-dim-label" style="border-color:${color};color:${color};">${fmtDist(d)}</span>`,
                iconSize: [0, 0]
            });
            L.marker([midLat, midLng], { icon: dimIcon, interactive: false, zIndexOffset: 1900 }).addTo(itemGroup);
        }

        data.coords.forEach(c => {
            const pinIcon = L.divIcon({
                className: 'lot-vertex-pin-wrap',
                html: `<div class="lot-vertex-pin" style="background:${color};" title="${esc(lotName)} - Vértice V${c.v}"><span>V${c.v}</span></div>`,
                iconSize: [26, 26],
                iconAnchor: [13, 13]
            });
            const dd = `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`;
            const utmStr = `E ${c.e.toFixed(2)} · N ${c.n.toFixed(2)}`;
            const m = L.marker(c.ll, { icon: pinIcon, zIndexOffset: 2450 }).addTo(itemGroup);
            m.bindTooltip(`<b>${esc(lotName)} — Vértice V${c.v}</b><br>UTM 22S: ${utmStr}<br>Lat/Lon: ${dd}<br><small>Clique para copiar</small>`, { direction: 'top', offset: [0, -14] });
            m.on('click', () => copyText(`${c.e.toFixed(2)}, ${c.n.toFixed(2)}`));
        });

        state.savedCoordLots.push({
            id: 'saved-lot-' + seq,
            seq,
            type: 'lot',
            name: lotName,
            color,
            coords: data.coords.map(c => ({ ...c })),
            pts: data.pts.slice(),
            area: data.area,
            perimeter: data.perimeter,
            sides: data.sides.map(s => ({ ...s })),
            cadHtml: data.cadHtml,
            group: itemGroup,
            bounds: poly.getBounds(),
            visible: true,
            expanded: false
        });

        const drawnCopy = L.polygon(data.pts, { color, weight: 3, fillColor: color, fillOpacity: 0.2 });
        registerDrawnLayer(drawnCopy, lotName);

        state.coordLotGroup.clearLayers();
        state.lastLocatedLot = null;

        renderSavedCoordLots();
        toast(`${lotName} salvo no mapa! Você já pode inserir outro lote/vértices para comparar.`, 'ok', 3200);
    }

    function saveCurrentCoordPoint() {
        if (!state.lastLocatedPoint) {
            toast('Localize um ponto primeiro antes de salvar.', 'err');
            return;
        }
        ensureCoordLotGroup();
        const pt = state.lastLocatedPoint;
        const seq = state.savedCoordSeq++;
        const color = SAVED_LOT_COLORS[(seq - 1) % SAVED_LOT_COLORS.length];
        const ptName = `Vértice P${seq}`;

        const itemGroup = new L.FeatureGroup().addTo(state.savedCoordLotsGroup);
        const pinIcon = L.divIcon({
            className: 'lot-vertex-pin-wrap',
            html: `<div class="lot-vertex-pin" style="background:${color};" title="${esc(ptName)}"><span>P${seq}</span></div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        });
        const dd = `${pt.lat.toFixed(6)}, ${pt.lng.toFixed(6)}`;
        const utmStr = `E ${pt.e.toFixed(2)} · N ${pt.n.toFixed(2)}`;
        const m = L.marker(pt.ll, { icon: pinIcon, zIndexOffset: 2480 }).addTo(itemGroup);
        m.bindTooltip(`<b>${esc(ptName)}</b><br>UTM 22S: ${utmStr}<br>Lat/Lon: ${dd}<br><small>Clique para copiar</small>`, { direction: 'top', offset: [0, -14] });
        m.on('click', () => copyText(`${pt.e.toFixed(2)}, ${pt.n.toFixed(2)}`));

        state.savedCoordLots.push({
            id: 'saved-pt-' + seq,
            seq,
            type: 'point',
            name: ptName,
            color,
            coords: [{ v: seq, e: pt.e, n: pt.n, lat: pt.lat, lng: pt.lng, ll: pt.ll }],
            pts: [pt.ll],
            area: 0,
            perimeter: 0,
            sides: [],
            group: itemGroup,
            bounds: L.latLngBounds([pt.ll, pt.ll]),
            visible: true,
            expanded: false
        });

        if (state.coordMarker) { state.coordMarker.remove(); state.coordMarker = null; }
        state.lastLocatedPoint = null;

        renderSavedCoordLots();
        toast(`${ptName} salvo no mapa! Digite ou capture outro vértice para comparar.`, 'ok', 2800);
    }

    function renderSavedCoordLots() {
        const wrap = $('co-saved-section');
        if (!wrap) return;
        const list = state.savedCoordLots || [];
        if (!list.length) {
            wrap.innerHTML = '';
            return;
        }

        const lotsForCompare = list.filter(x => x.type === 'lot').map(x => ({ name: x.name, area: x.area, perimeter: x.perimeter, color: x.color }));
        if (state.lastLocatedLot) {
            lotsForCompare.push({ name: 'Lote Atual (Em tela)', area: state.lastLocatedLot.area, perimeter: state.lastLocatedLot.perimeter, color: '#0284c7' });
        }

        let compareBanner = '';
        if (lotsForCompare.length >= 2) {
            const a = lotsForCompare[lotsForCompare.length - 2];
            const b = lotsForCompare[lotsForCompare.length - 1];
            const diffArea = b.area - a.area;
            const diffPerim = b.perimeter - a.perimeter;
            const pctArea = a.area > 0 ? ((diffArea / a.area) * 100).toFixed(2) : '0.00';
            const signA = diffArea >= 0 ? '+' : '';
            const signP = diffPerim >= 0 ? '+' : '';
            compareBanner = `
                <div class="co-compare-banner">
                    <div><i class="fa-solid fa-scale-balanced"></i> <b>Comparativo:</b> ${esc(a.name)} vs ${esc(b.name)}</div>
                    <div>• Δ Área: <b>${signA}${diffArea.toFixed(2)} m² (${signA}${pctArea}%)</b> · Δ Perímetro: <b>${signP}${diffPerim.toFixed(2)} m</b></div>
                </div>`;
        } else {
            const ptsForCompare = list.filter(x => x.type === 'point').map(x => ({ name: x.name, c: x.coords[0] }));
            if (state.lastLocatedPoint) {
                ptsForCompare.push({ name: 'Ponto Atual', c: state.lastLocatedPoint });
            }
            if (ptsForCompare.length >= 2) {
                const p1 = ptsForCompare[ptsForCompare.length - 2];
                const p2 = ptsForCompare[ptsForCompare.length - 1];
                const dist = p1.c.ll.distanceTo(p2.c.ll);
                const dE = p2.c.e - p1.c.e;
                const dN = p2.c.n - p1.c.n;
                compareBanner = `
                    <div class="co-compare-banner">
                        <div><i class="fa-solid fa-ruler-horizontal"></i> <b>Distância (${esc(p1.name)} → ${esc(p2.name)}):</b> <b>${fmtDist(dist)}</b></div>
                        <div>• ΔE: <b>${dE >= 0 ? '+' : ''}${dE.toFixed(2)} m</b> · ΔN: <b>${dN >= 0 ? '+' : ''}${dN.toFixed(2)} m</b></div>
                    </div>`;
            }
        }

        wrap.innerHTML = `
            <div class="co-saved-wrap">
                <div class="co-saved-header">
                    <span><i class="fa-solid fa-layer-group"></i> Vértices / Lotes Salvos (${list.length})</span>
                    <div class="co-saved-actions">
                        <button type="button" class="co-mini-btn" id="co-fit-all-saved" title="Enquadrar todos os lotes/vértices salvos no mapa"><i class="fa-solid fa-expand"></i> Ver Todos</button>
                        <button type="button" class="co-mini-btn danger" id="co-clear-all-saved" title="Remover todos os salvos"><i class="fa-solid fa-trash"></i> Limpar</button>
                    </div>
                </div>
                ${compareBanner}
                <div id="co-saved-items-list">
                    ${list.map((item, idx) => {
                        if (item.type === 'point') {
                            const c = item.coords[0];
                            return `
                                <div class="co-saved-item ${item.visible ? '' : 'hidden-map'}" style="border-left-color:${item.color};" data-idx="${idx}">
                                    <div class="co-saved-top">
                                        <div class="co-saved-title">
                                            <span class="co-saved-dot" style="background:${item.color};"></span>
                                            <span>${esc(item.name)}</span>
                                        </div>
                                        <div class="co-saved-actions">
                                            <button type="button" class="co-mini-btn" data-act="zoom" data-idx="${idx}" title="Focar neste vértice"><i class="fa-solid fa-magnifying-glass-location"></i></button>
                                            <button type="button" class="co-mini-btn" data-act="vis" data-idx="${idx}" title="Mostrar / Ocultar no mapa"><i class="fa-solid ${item.visible ? 'fa-eye' : 'fa-eye-slash'}"></i></button>
                                            <button type="button" class="co-mini-btn danger" data-act="del" data-idx="${idx}" title="Excluir"><i class="fa-solid fa-trash-can"></i></button>
                                        </div>
                                    </div>
                                    <div class="co-saved-meta">
                                        <span>UTM: <b>E ${c.e.toFixed(2)} · N ${c.n.toFixed(2)}</b></span>
                                        <span>Lat/Lon: <b>${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}</b></span>
                                    </div>
                                </div>`;
                        }
                        return `
                            <div class="co-saved-item ${item.visible ? '' : 'hidden-map'}" style="border-left-color:${item.color};" data-idx="${idx}">
                                <div class="co-saved-top">
                                    <div class="co-saved-title">
                                        <span class="co-saved-dot" style="background:${item.color};"></span>
                                        <span>${esc(item.name)}</span>
                                    </div>
                                    <div class="co-saved-actions">
                                        <button type="button" class="co-mini-btn" data-act="zoom" data-idx="${idx}" title="Focar neste lote"><i class="fa-solid fa-magnifying-glass-location"></i></button>
                                        <button type="button" class="co-mini-btn" data-act="table" data-idx="${idx}" title="Ver / Ocultar coordenadas dos vértices"><i class="fa-solid fa-table-list"></i></button>
                                        <button type="button" class="co-mini-btn" data-act="load" data-idx="${idx}" title="Carregar estas coordenadas nos campos de edição"><i class="fa-solid fa-pen-to-square"></i></button>
                                        <button type="button" class="co-mini-btn" data-act="vis" data-idx="${idx}" title="Mostrar / Ocultar no mapa"><i class="fa-solid ${item.visible ? 'fa-eye' : 'fa-eye-slash'}"></i></button>
                                        <button type="button" class="co-mini-btn danger" data-act="del" data-idx="${idx}" title="Excluir"><i class="fa-solid fa-trash-can"></i></button>
                                    </div>
                                </div>
                                <div class="co-saved-meta">
                                    <span>Área: <b>${fmtArea(item.area)}</b></span>
                                    <span>Perímetro: <b>${fmtDist(item.perimeter)}</b></span>
                                </div>
                                ${item.expanded ? `
                                    <div class="co-table-wrap" style="margin-top:6px;margin-bottom:0;">
                                        <table class="co-table">
                                            <thead>
                                                <tr><th>V</th><th>Este (E)</th><th>Norte (N)</th><th>Lado</th></tr>
                                            </thead>
                                            <tbody>
                                                ${item.coords.map((c, i) => `<tr>
                                                    <td><b style="color:${item.color};">V${c.v}</b></td>
                                                    <td>${c.e.toFixed(2)}</td>
                                                    <td>${c.n.toFixed(2)}</td>
                                                    <td>V${c.v}–V${item.sides[i].to}: <b>${fmtDist(item.sides[i].d)}</b></td>
                                                </tr>`).join('')}
                                            </tbody>
                                        </table>
                                    </div>
                                ` : ''}
                            </div>`;
                    }).join('')}
                </div>
            </div>`;

        $('co-fit-all-saved').addEventListener('click', () => {
            const bounds = L.latLngBounds([]);
            list.forEach(item => {
                if (item.visible && item.bounds) bounds.extend(item.bounds);
            });
            if (state.coordLotGroup && state.coordLotGroup.getLayers().length) {
                bounds.extend(state.coordLotGroup.getBounds());
            }
            if (bounds.isValid()) {
                map.fitBounds(bounds, { padding: [60, 60], maxZoom: 19 });
            }
        });

        $('co-clear-all-saved').addEventListener('click', () => {
            if (state.savedCoordLotsGroup) state.savedCoordLotsGroup.clearLayers();
            state.savedCoordLots = [];
            renderSavedCoordLots();
            toast('Todos os lotes/vértices salvos foram removidos.', 'info', 1800);
        });

        wrap.querySelectorAll('[data-act]').forEach(btn => {
            btn.addEventListener('click', () => {
                const act = btn.getAttribute('data-act');
                const idx = parseInt(btn.getAttribute('data-idx'), 10);
                const item = state.savedCoordLots[idx];
                if (!item) return;

                if (act === 'zoom') {
                    if (item.type === 'point') {
                        map.flyTo(item.coords[0].ll, Math.max(map.getZoom(), 18), { duration: 0.9 });
                    } else {
                        map.fitBounds(item.bounds, { padding: [55, 55], maxZoom: 19 });
                    }
                } else if (act === 'table') {
                    item.expanded = !item.expanded;
                    renderSavedCoordLots();
                } else if (act === 'load') {
                    const isUtm = $('co-mode') ? $('co-mode').value === 'utm' : true;
                    const vals = item.coords.map(c => ({
                        a: isUtm ? c.e.toFixed(2) : c.lat.toFixed(6),
                        b: isUtm ? c.n.toFixed(2) : c.lng.toFixed(6)
                    }));
                    setVertexRowCount(Math.max(4, item.coords.length), vals);
                    toast(`Coordenadas de ${item.name} carregadas nos campos!`, 'info', 2000);
                } else if (act === 'vis') {
                    item.visible = !item.visible;
                    if (item.visible) {
                        state.savedCoordLotsGroup.addLayer(item.group);
                    } else {
                        state.savedCoordLotsGroup.removeLayer(item.group);
                    }
                    renderSavedCoordLots();
                } else if (act === 'del') {
                    state.savedCoordLotsGroup.removeLayer(item.group);
                    state.savedCoordLots.splice(idx, 1);
                    renderSavedCoordLots();
                    toast(`${item.name} removido.`, 'info', 1600);
                }
            });
        });
    }

    function clearCoordLot() {
        if (state.coordLotGroup) state.coordLotGroup.clearLayers();
        if (state.coordMarker) { state.coordMarker.remove(); state.coordMarker = null; }
        if (state.coordTempGroup) state.coordTempGroup.clearLayers();
        state.lastLocatedLot = null;
        state.lastLocatedPoint = null;
        const out = $('co-out');
        if (out) out.innerHTML = 'Nenhum lote ou coordenada localizado.';
        renderSavedCoordLots();
        toast('Visualização ativa limpa (os lotes salvos permanecem no mapa).', 'info', 1800);
    }

    function showCoordInfo(latlng, flyTo) {
        ensureCoordLotGroup();
        const u = toUTM22S(latlng.lat, latlng.lng);
        const dd = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
        const utm = `E ${u.x} N ${u.y}`;
        if (state.coordMarker) state.coordMarker.remove();
        state.coordMarker = L.marker(latlng).addTo(state.coordLotGroup).bindPopup(`<b>Ponto</b><br>Lat/Lon: ${dd}<br>UTM 22S: ${utm}`).openPopup();
        if (flyTo) map.flyTo(latlng, Math.max(map.getZoom(), 17), { duration: 1 });

        state.lastLocatedPoint = {
            lat: latlng.lat,
            lng: latlng.lng,
            e: parseFloat(u.x),
            n: parseFloat(u.y),
            ll: latlng
        };

        const out = $('co-out');
        if (out) {
            out.innerHTML = `<div><b>Lat/Lon:</b> ${dd} <button type="button" class="mini-copy" data-c="${dd}" title="Copiar"><i class="fa-regular fa-copy"></i></button></div>
                <div><b>UTM 22S:</b> ${utm} <button type="button" class="mini-copy" data-c="${u.x}, ${u.y}" title="Copiar"><i class="fa-regular fa-copy"></i></button></div>
                <div style="margin-top:6px;">
                    <button type="button" class="tp-btn primary" id="co-save-pt" style="width:100%;"><i class="fa-solid fa-floppy-disk"></i> Salvar Vértice p/ Comparar</button>
                </div>`;
            out.querySelectorAll('.mini-copy').forEach(b => b.addEventListener('click', () => copyText(b.dataset.c)));
            $('co-save-pt').addEventListener('click', saveCurrentCoordPoint);
        }
        renderSavedCoordLots();
    }

    function goToCoord() {
        const a = num($('co-a').value), b = num($('co-b').value);
        if (!isFinite(a) || !isFinite(b)) { toast('Informe dois valores numéricos.', 'err'); return; }
        let ll;
        if ($('co-mode').value === 'utm') {
            if (a < 100000 || a > 900000 || b < 6000000 || b > 8000000) { toast('Valores UTM fora da faixa esperada (E 100000–900000, N 6000000–8000000).', 'err'); return; }
            ll = fromUTM22S(a, b);
        } else {
            if (Math.abs(a) > 90 || Math.abs(b) > 180) { toast('Latitude/longitude inválidas.', 'err'); return; }
            ll = { lat: a, lng: b };
        }
        showCoordInfo(L.latLng(ll.lat, ll.lng), true);
    }

    function togglePick(mode) {
        mode = mode || state.coordTab || 'single';
        const isLot = mode === 'lot';
        const btn = isLot ? $('co-pick-lot') : $('co-pick');
        const targetCount = state.coordVertexCount || 4;

        if (state.coordPickMode === mode) {
            stopPick();
            return;
        }
        stopPick();

        window.GEO_TOOL_BUSY = true;
        state.coordPickMode = mode;
        state.coordPickPts = [];
        ensureCoordLotGroup();
        if (state.coordTempGroup) state.coordTempGroup.clearLayers();
        map.getContainer().classList.add('pick-cursor');

        if (btn) {
            btn.classList.add('active');
            btn.innerHTML = isLot
                ? `<i class="fa-solid fa-hand-pointer"></i> Clique no Vértice V1... (0/${targetCount})`
                : '<i class="fa-solid fa-hand-pointer"></i> Clique no mapa... (clique p/ parar)';
        }

        state.pickHandler = e => {
            const ll = (state.activeSnap && state.snapOn) ? state.activeSnap.ll : e.latlng;
            if (!isLot) {
                showCoordInfo(ll, false);
                const isUtm = $('co-mode').value === 'utm';
                if (isUtm) {
                    const u = toUTM22S(ll.lat, ll.lng);
                    $('co-a').value = u.x;
                    $('co-b').value = u.y;
                } else {
                    $('co-a').value = ll.lat.toFixed(6);
                    $('co-b').value = ll.lng.toFixed(6);
                }
                stopPick();
                return;
            }

            const currentTarget = state.coordVertexCount || 4;
            state.coordPickPts.push(ll);
            const idx = state.coordPickPts.length;
            const isUtm = $('co-mode').value === 'utm';
            if (isUtm) {
                const u = toUTM22S(ll.lat, ll.lng);
                if ($(`co-v${idx}-a`)) $(`co-v${idx}-a`).value = u.x;
                if ($(`co-v${idx}-b`)) $(`co-v${idx}-b`).value = u.y;
            } else {
                if ($(`co-v${idx}-a`)) $(`co-v${idx}-a`).value = ll.lat.toFixed(6);
                if ($(`co-v${idx}-b`)) $(`co-v${idx}-b`).value = ll.lng.toFixed(6);
            }

            const tempIcon = L.divIcon({
                className: 'lot-vertex-pin-wrap',
                html: `<div class="lot-vertex-pin" style="background:#0ea5e9;"><span>V${idx}</span></div>`,
                iconSize: [26, 26],
                iconAnchor: [13, 13]
            });
            L.marker(ll, { icon: tempIcon, zIndexOffset: 2400 }).addTo(state.coordTempGroup);

            if (idx > 1) {
                L.polyline([state.coordPickPts[idx - 2], ll], { color: '#0ea5e9', weight: 2.5, dashArray: '4, 4' }).addTo(state.coordTempGroup);
            }

            if (idx < currentTarget) {
                if (btn) btn.innerHTML = `<i class="fa-solid fa-hand-pointer"></i> Clique no Vértice V${idx + 1}... (${idx}/${currentTarget})`;
            } else {
                stopPick();
                toast(`${currentTarget} vértices capturados! Gerando lote...`, 'ok', 2000);
                locateLot();
            }
        };

        map.on('click', state.pickHandler);
    }

    function stopPick() {
        if (state.pickHandler) map.off('click', state.pickHandler);
        state.pickHandler = null;
        state.coordPickMode = null;
        state.coordPickPts = [];
        if (state.coordTempGroup) state.coordTempGroup.clearLayers();
        window.GEO_TOOL_BUSY = !!state.drawMode;
        map.getContainer().classList.remove('pick-cursor');

        const btnSingle = $('co-pick');
        if (btnSingle) {
            btnSingle.classList.remove('active');
            btnSingle.innerHTML = '<i class="fa-solid fa-crosshairs"></i> Ativar captura por clique';
        }
        const btnLot = $('co-pick-lot');
        if (btnLot) {
            const n = state.coordVertexCount || 4;
            btnLot.classList.remove('active');
            btnLot.innerHTML = `<i class="fa-solid fa-crosshairs"></i> Capturar ${n} vértices por clique`;
        }
    }
    /* ---------- MOTOR DE DESENHO, ANOTAÇÃO E EXPORTAÇÃO ---------- */
    function ensureDrawnGroup() {
        if (!state.drawnItems) {
            state.drawnItems = new L.FeatureGroup().addTo(map);
        }
        if (!state.drawVerts) {
            state.drawVerts = new L.LayerGroup().addTo(map);
        }
        if (!state.vertexGroup) {
            state.vertexGroup = new L.LayerGroup().addTo(map);
        }
    }

    /* ---------- VÉRTICES E COORDENADAS DOS DESENHOS ---------- */
    function getVertices(l) {
        const flat = arr => Array.isArray(arr) ? arr.reduce((a, x) => a.concat(Array.isArray(x) ? flat(x) : [x]), []) : [arr];
        if (l instanceof L.Circle || l instanceof L.Marker) return [l.getLatLng()];
        if (l.getLatLngs) {
            let pts = flat(l.getLatLngs());
            // remove vértice de fechamento duplicado
            if (l instanceof L.Polygon && pts.length > 1 && pts[0].equals(pts[pts.length - 1])) pts = pts.slice(0, -1);
            return pts;
        }
        return [];
    }

    function vertexRows() {
        const rows = [];
        state.drawnList.forEach(l => {
            getVertices(l).forEach((ll, i) => {
                const u = toUTM22S(ll.lat, ll.lng);
                rows.push({ nome: l._note || l._typeLabel, tipo: l._typeLabel, v: i + 1, lat: ll.lat, lng: ll.lng, e: u.x, n: u.y });
            });
        });
        return rows;
    }

    function refreshVertices() {
        if (!state.vertexGroup) return;
        state.vertexGroup.clearLayers();
        if (!state.showVerts) return;
        state.drawnList.forEach(l => {
            if (l instanceof L.Marker && l._isText) return;
            getVertices(l).forEach((ll, i) => {
                const u = toUTM22S(ll.lat, ll.lng);
                const dd = `${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}`;
                const m = L.circleMarker(ll, { radius: 6, color: '#111827', weight: 2, fillColor: '#fde047', fillOpacity: 1, bubblingMouseEvents: false });
                m.bindTooltip(`<b>${esc(l._note || l._typeLabel)} · V${i + 1}</b><br>Lat/Lon: ${dd}<br>UTM 22S: E ${u.x} N ${u.y}<br><small>Clique para copiar</small>`, { direction: 'top', offset: [0, -6] });
                m.on('click', () => copyText(dd));
                state.vertexGroup.addLayer(m);
            });
        });
    }

    function buildCoordTable() {
        const rows = vertexRows();
        const out = $('vx-out');
        if (!out) return;
        if (!rows.length) { out.innerHTML = '<div class="tp-hint">Desenhe ao menos uma poligonal, linha ou ponto para gerar as coordenadas.</div>'; return; }
        const f = n => n.toFixed(6);
        out.innerHTML = `<div class="vx-table-wrap"><table class="vx-table"><thead><tr><th>Desenho</th><th>V</th><th>Latitude</th><th>Longitude</th><th>UTM E</th><th>UTM N</th></tr></thead><tbody>${
            rows.map(r => `<tr><td>${esc(r.nome)}</td><td>${r.v}</td><td>${f(r.lat)}</td><td>${f(r.lng)}</td><td>${r.e}</td><td>${r.n}</td></tr>`).join('')
        }</tbody></table></div>
        <div class="tp-row three">
            <button type="button" class="tp-btn" id="vx-copy"><i class="fa-regular fa-copy"></i> Copiar</button>
            <button type="button" class="tp-btn" id="vx-csv"><i class="fa-solid fa-file-csv"></i> CSV</button>
            <button type="button" class="tp-btn" id="vx-txt"><i class="fa-solid fa-file-lines"></i> TXT</button>
        </div>
        <div class="tp-row"><button type="button" class="tp-btn danger" id="vx-clear"><i class="fa-solid fa-eraser"></i> Limpar coordenadas geradas</button></div>`;
        $('vx-clear').addEventListener('click', () => { out.innerHTML = ''; toast('Coordenadas geradas foram removidas.', 'info', 2200); });
        const sep = '\t';
        const header = ['Desenho', 'Vertice', 'Latitude', 'Longitude', 'UTM_E_22S', 'UTM_N_22S'];
        const lines = rows.map(r => [r.nome, r.v, f(r.lat), f(r.lng), r.e, r.n]);
        $('vx-copy').addEventListener('click', () => copyText([header.join(sep)].concat(lines.map(x => x.join(sep))).join('\n')));
        $('vx-csv').addEventListener('click', () => download('vertices_matinhos.csv', '\ufeff' + [header.join(';')].concat(lines.map(x => x.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';'))).join('\r\n'), 'text/csv;charset=utf-8'));
        $('vx-txt').addEventListener('click', () => download('vertices_matinhos.txt', [header.join(sep)].concat(lines.map(x => x.join(sep))).join('\r\n'), 'text/plain;charset=utf-8'));
    }

    /* ---------- ADERÊNCIA (SNAP MAGNÉTICO DE ALTO DESEMPENHO) ---------- */
    function ensureSnapPane() {
        if (!map || map.getPane('snapPane')) return;
        const pane = map.createPane('snapPane');
        pane.style.zIndex = '750';
        pane.style.pointerEvents = 'none';
    }

    function ringsOf(l) {
        const out = [];
        const isCoord = x => x && (x instanceof L.LatLng || (typeof x.lat === 'number' && typeof x.lng === 'number'));
        const walk = a => {
            if (!Array.isArray(a) || !a.length) return;
            if (isCoord(a[0])) {
                out.push(a.map(p => (p instanceof L.LatLng) ? p : L.latLng(p.lat, p.lng)));
            } else {
                a.forEach(walk);
            }
        };
        if (l.getLatLngs) walk(l.getLatLngs());
        else if (l.getLatLng) {
            const ll = l.getLatLng();
            if (ll) out.push([ll instanceof L.LatLng ? ll : L.latLng(ll.lat, ll.lng)]);
        }
        return out;
    }

    function findSnap(latlng) {
        if (!state.snapOn || !map) return null;
        const p = map.latLngToContainerPoint(latlng);
        const tol = state.snapTol || 18;
        const edges = state.snapMode === 'both';

        // Caixa delimitadora geográfica ao redor do cursor (+/- tol px) para descarte instantâneo
        const pSw = map.containerPointToLatLng(L.point(p.x - tol, p.y + tol));
        const pNe = map.containerPointToLatLng(L.point(p.x + tol, p.y - tol));
        const searchBounds = L.latLngBounds(pSw, pNe);

        let bestV = null, bestVd = Infinity, isStart = false;
        let bestE = null, bestEd = Infinity;

        // 1. Prioridade máxima: vértices do desenho ativo (e fechamento automático de polígono no 1º vértice)
        if (state.drawPts && state.drawPts.length) {
            const pts = state.drawPts;
            if (state.drawMode === 'polygon' && pts.length >= 3) {
                const p0 = pts[0];
                const p0Cp = map.latLngToContainerPoint(p0);
                const d0 = p0Cp.distanceTo(p);
                if (d0 <= tol + 5) {
                    bestV = p0;
                    bestVd = d0;
                    isStart = true;
                }
            }
            if (!isStart) {
                for (let i = 0; i < pts.length; i++) {
                    const pt = pts[i];
                    if (searchBounds.contains(pt)) {
                        const cp = map.latLngToContainerPoint(pt);
                        const d = cp.distanceTo(p);
                        if (d < bestVd && d <= tol) {
                            bestVd = d;
                            bestV = pt;
                            if (i === 0 && state.drawMode === 'polygon' && pts.length >= 3) isStart = true;
                        }
                    }
                }
            }
        }

        // Teste de anel de coordenadas com descarte espacial prévio (apenas projeta se dentro do searchBounds)
        const testRing = (pts, closed) => {
            if (!pts || !pts.length) return;
            const len = pts.length;
            for (let i = 0; i < len; i++) {
                const pt = pts[i];
                if (searchBounds.contains(pt)) {
                    const cp = map.latLngToContainerPoint(pt);
                    const d = cp.distanceTo(p);
                    if (d < bestVd && d <= tol) {
                        bestVd = d;
                        bestV = pt;
                        isStart = false;
                    }
                }
                if (edges) {
                    let next = null;
                    if (i + 1 < len) next = pts[i + 1];
                    else if (closed && len > 2) next = pts[0];
                    if (next) {
                        const segBounds = L.latLngBounds(pt, next);
                        if (searchBounds.intersects(segBounds)) {
                            const cp1 = map.latLngToContainerPoint(pt);
                            const cp2 = map.latLngToContainerPoint(next);
                            const c = L.LineUtil.closestPointOnSegment(p, cp1, cp2);
                            const dd = c.distanceTo(p);
                            if (dd < bestEd && dd <= tol) {
                                bestEd = dd;
                                bestE = map.containerPointToLatLng(c);
                            }
                        }
                    }
                }
            }
        };

        const testFeatureLayer = l => {
            if (!l) return;
            if (l.getBounds) {
                try {
                    const b = l.getBounds();
                    if (b && b.isValid && b.isValid() && !searchBounds.intersects(b)) return;
                } catch (_) {}
            }
            const closed = l instanceof L.Polygon;
            const rings = ringsOf(l);
            for (let r = 0; r < rings.length; r++) testRing(rings[r], closed);
        };

        // 2. Camadas vetoriais ligadas no mapa (Loteamentos, Zoneamento, Bairros, etc.)
        if (typeof layersMap !== 'undefined' && layersMap) {
            Object.values(layersMap).forEach(g => {
                if (g && map.hasLayer(g)) {
                    if (g.getBounds) {
                        try {
                            const gb = g.getBounds();
                            if (gb && gb.isValid && gb.isValid() && !searchBounds.intersects(gb)) return;
                        } catch (_) {}
                    }
                    if (g.eachLayer) g.eachLayer(testFeatureLayer);
                }
            });
        }

        // 3. Desenhos já criados e salvos no mapa
        if (state.drawnList && state.drawnList.length) {
            state.drawnList.forEach(l => {
                if (l instanceof L.Circle || l._isText) return;
                testFeatureLayer(l);
            });
        }

        if (bestV && bestVd <= (isStart ? tol + 5 : tol)) {
            return { ll: bestV, kind: 'vertex', isStartPoint: isStart, dist: bestVd };
        }
        if (bestE && bestEd <= tol) {
            return { ll: bestE, kind: 'edge', isStartPoint: false, dist: bestEd };
        }
        return null;
    }

    function snapLatLng(latlng) {
        if (!state.snapOn) return latlng;
        const t = state.activeSnap || findSnap(latlng);
        return t ? t.ll : latlng;
    }

    function showSnapMarker(t) {
        ensureSnapPane();
        if (!t) {
            if (state.snapMarker) { state.snapMarker.remove(); state.snapMarker = null; }
            if (state.snapBadge) { state.snapBadge.remove(); state.snapBadge = null; }
            return;
        }

        let color = '#d946ef';
        let fillColor = '#ffffff';
        let fillOpacity = 0.95;
        let radius = 7.5;
        let weight = 2.5;
        let label = 'Vértice';
        let badgeCls = 'vertex';

        if (t.isStartPoint) {
            color = '#10b981';
            fillColor = '#10b981';
            fillOpacity = 0.45;
            radius = 9.5;
            weight = 3;
            label = 'Fechar Polígono';
            badgeCls = 'start-pt';
        } else if (t.kind === 'edge') {
            color = '#7c3aed';
            fillColor = '#7c3aed';
            fillOpacity = 0.25;
            radius = 6;
            weight = 2.5;
            label = 'Aresta';
            badgeCls = 'edge';
        }

        const markerStyle = {
            pane: 'snapPane',
            radius,
            color,
            weight,
            fillColor,
            fillOpacity,
            interactive: false
        };

        if (!state.snapMarker) {
            state.snapMarker = L.circleMarker(t.ll, markerStyle).addTo(map);
        } else {
            state.snapMarker.setLatLng(t.ll);
            state.snapMarker.setStyle(markerStyle);
        }

        const icon = L.divIcon({
            className: 'snap-badge-icon',
            html: `<div class="snap-tooltip ${badgeCls}"><span>${label}</span></div>`,
            iconSize: [0, 0],
            iconAnchor: [-10, 10]
        });

        if (!state.snapBadge) {
            state.snapBadge = L.marker(t.ll, { pane: 'snapPane', icon, interactive: false }).addTo(map);
        } else {
            state.snapBadge.setLatLng(t.ll);
            state.snapBadge.setIcon(icon);
        }
    }

    /* ---------- EXTRAÇÃO DE VÉRTICES DE LOTES, ZONAS E DEMAIS CAMADAS ---------- */
    function geomRings(g) {
        const out = [];
        if (!g) return out;
        const clean = r => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) ? r.slice(0, -1) : r;
        switch (g.type) {
            case 'Point': out.push({ parte: 1, anel: 1, pts: [g.coordinates] }); break;
            case 'MultiPoint': g.coordinates.forEach((c, i) => out.push({ parte: i + 1, anel: 1, pts: [c] })); break;
            case 'LineString': out.push({ parte: 1, anel: 1, pts: g.coordinates }); break;
            case 'MultiLineString': g.coordinates.forEach((r, i) => out.push({ parte: i + 1, anel: 1, pts: r })); break;
            case 'Polygon': g.coordinates.forEach((r, j) => out.push({ parte: 1, anel: j + 1, pts: clean(r) })); break;
            case 'MultiPolygon': g.coordinates.forEach((poly, i) => poly.forEach((r, j) => out.push({ parte: i + 1, anel: j + 1, pts: clean(r) }))); break;
            case 'GeometryCollection': (g.geometries || []).forEach(x => geomRings(x).forEach(r => out.push(r))); break;
            default: break;
        }
        return out;
    }

    function featureVertexRows(feature, camada) {
        const nome = featureName(feature.properties, null);
        const rows = [];
        geomRings(feature.geometry).forEach(r => r.pts.forEach((c, i) => {
            const u = toUTM22S(c[1], c[0]);
            rows.push({
                camada,
                nome,
                anel: `${r.parte}.${r.anel}`,
                v: i + 1,
                lat: c[1],
                lng: c[0],
                e: u.x,
                n: u.y,
                e_num: u.easting,
                n_num: u.northing,
                feature
            });
        }));
        return rows;
    }

    function extractableLayers() {
        const list = [];
        Object.entries(layersMap).forEach(([id, g]) => {
            if (!g || !g.eachLayer) return;
            let first = null;
            g.eachLayer(l => { if (!first && l.feature) first = l; });
            if (first) list.push({ id, title: layerTitle(first, id), visible: map.hasLayer(g) });
        });
        return list;
    }

    function fillLayerSelect() {
        const sel = $('vl-layer');
        if (!sel) return;
        const prev = sel.value;
        sel.innerHTML = extractableLayers().map(x => `<option value="${esc(x.id)}">${x.visible ? '● ' : '○ '}${esc(x.title)}</option>`).join('');
        if (prev && sel.querySelector(`option[value="${prev}"]`)) sel.value = prev;
    }

    function buildVertsPanel(body) {
        body.innerHTML = `
            <p class="tp-hint" style="margin-top:0;">Extraia as coordenadas de todos os vértices de lotes, zonas e demais feições das camadas (● ligada / ○ desligada).</p>
            <div class="tp-sub" style="margin-top:0;">Camada</div>
            <div class="tp-row"><select id="vl-layer" class="tp-input"></select></div>
            <div class="tp-row two">
                <button type="button" class="tp-btn primary" id="vl-all"><i class="fa-solid fa-layer-group"></i> Camada inteira</button>
                <button type="button" class="tp-btn" id="vl-pick"><i class="fa-solid fa-hand-pointer"></i> Clicar numa feição</button>
            </div>
            <label class="tp-check"><input type="checkbox" id="vl-show" checked> Mostrar os vértices no mapa</label>
            <div id="vl-out"></div>
            <div class="tp-row"><button type="button" class="tp-btn danger" id="vl-clear"><i class="fa-solid fa-eraser"></i> Limpar vértices do mapa</button></div>`;
        fillLayerSelect();
        $('vl-all').addEventListener('click', () => {
            const id = $('vl-layer').value;
            const g = layersMap[id];
            if (!g) { toast('Selecione uma camada.', 'err'); return; }
            const rows = [];
            let n = 0;
            g.eachLayer(l => { if (l.feature) { n++; featureVertexRows(l.feature, layerTitle(l, id)).forEach(r => rows.push(r)); } });
            showExtraction(rows, n);
        });
        $('vl-pick').addEventListener('click', () => { if (state.vertPick) stopVertPick(); else startVertPick(); });
        $('vl-clear').addEventListener('click', clearExtraction);
        $('vl-show').addEventListener('change', e => { if (!e.target.checked && state.extractGroup) state.extractGroup.clearLayers(); });
    }

    function startVertPick() {
        const sel = $('vl-layer');
        if (!sel || !sel.value) { toast('Selecione uma camada.', 'err'); return; }
        window.GEO_TOOL_BUSY = true;
        state.vertPick = e => {
            const id = $('vl-layer').value;
            const g = layersMap[id];
            if (!g) return;
            let hit = null;
            g.eachLayer(l => { if (!hit && l.feature && l.getBounds && l.getBounds().contains(e.latlng) && pointInGeom(e.latlng.lat, e.latlng.lng, l.feature.geometry)) hit = l; });
            if (!hit) { toast('Nenhuma feição desta camada neste ponto.', 'err', 2200); return; }
            showExtraction(featureVertexRows(hit.feature, layerTitle(hit, id)), 1);
        };
        map.on('click', state.vertPick);
        map.getContainer().classList.add('pick-cursor');
        const b = $('vl-pick');
        if (b) { b.classList.add('active'); b.innerHTML = '<i class="fa-solid fa-hand-pointer"></i> Clique no mapa... (parar)'; }
    }

    function stopVertPick() {
        if (state.vertPick) map.off('click', state.vertPick);
        state.vertPick = null;
        window.GEO_TOOL_BUSY = !!(state.drawMode || state.pickHandler);
        map.getContainer().classList.remove('pick-cursor');
        const b = $('vl-pick');
        if (b) { b.classList.remove('active'); b.innerHTML = '<i class="fa-solid fa-hand-pointer"></i> Clicar numa feição'; }
    }

    function clearExtraction() {
        if (state.extractGroup) state.extractGroup.clearLayers();
        const out = $('vl-out'); if (out) out.innerHTML = '';
    }

    function showExtraction(rows, nFeat) {
        const out = $('vl-out');
        if (!out) return;
        if (state.extractGroup) state.extractGroup.clearLayers();
        if (!rows.length) { out.innerHTML = '<div class="tp-hint">Nenhum vértice encontrado.</div>'; return; }
        const f = n => n.toFixed(7);
        const CAP = 300;
        let areaInfo = '';
        if (nFeat === 1 && rows.length >= 3 && rows[0].feature) {
            const a = calculateApproxArea(rows[0].feature.geometry);
            const p = calcPerimeter(rows[0].feature.geometry);
            areaInfo = `<div class="co-cad-info" style="margin:6px 0;background:#f0fdf4;border:1.5px solid #16a34a;padding:8px 12px;border-radius:7px;font-size:0.78rem;"><i class="fa-solid fa-calculator" style="color:#16a34a;"></i> <b>Área Total Calibrada (SIRGAS 2000 UTM 22S):</b> <span style="color:#15803d;font-weight:800;font-size:0.85rem;">${fmtArea(a)}</span> &nbsp;·&nbsp; <b>Perímetro:</b> <span style="color:#0f766e;font-weight:700;">${fmtDist(p)}</span></div>`;
        }
        out.innerHTML = `<div class="tp-hint"><b>${rows.length.toLocaleString('pt-BR')}</b> vértice(s) em <b>${nFeat}</b> feição(ões)${rows.length > CAP ? ` — tabela mostra os ${CAP} primeiros; a exportação traz todos` : ''}.</div>
            ${areaInfo}
            <div class="vx-table-wrap"><table class="vx-table"><thead><tr><th>Feição</th><th>Anel</th><th>V</th><th>Latitude</th><th>Longitude</th><th>UTM E (m)</th><th>UTM N (m)</th></tr></thead><tbody>${
                rows.slice(0, CAP).map(r => `<tr><td>${esc(r.nome)}</td><td>${r.anel}</td><td>${r.v}</td><td>${f(r.lat)}</td><td>${f(r.lng)}</td><td><b>${r.e}</b></td><td><b>${r.n}</b></td></tr>`).join('')
            }</tbody></table></div>
            <div class="tp-row three">
                <button type="button" class="tp-btn" id="vl-copy"><i class="fa-regular fa-copy"></i> Copiar</button>
                <button type="button" class="tp-btn" id="vl-csv"><i class="fa-solid fa-file-csv"></i> CSV</button>
                <button type="button" class="tp-btn" id="vl-txt"><i class="fa-solid fa-file-lines"></i> TXT</button>
            </div>`;
        const header = ['Camada', 'Feicao', 'Anel', 'Vertice', 'Latitude', 'Longitude', 'UTM_E_22S', 'UTM_N_22S'];
        const lines = () => rows.map(r => [r.camada, r.nome, r.anel, r.v, f(r.lat), f(r.lng), r.e, r.n]);
        $('vl-copy').addEventListener('click', () => copyText([header.join('\t')].concat(lines().map(x => x.join('\t'))).join('\n')));
        $('vl-csv').addEventListener('click', () => download('vertices_camada.csv', '\ufeff' + [header.join(';')].concat(lines().map(x => x.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';'))).join('\r\n'), 'text/csv;charset=utf-8'));
        $('vl-txt').addEventListener('click', () => download('vertices_camada.txt', [header.join('\t')].concat(lines().map(x => x.join('\t'))).join('\r\n'), 'text/plain;charset=utf-8'));

        if ($('vl-show') && $('vl-show').checked) {
            if (rows.length > 3000) { toast(`Muitos vértices (${rows.length.toLocaleString('pt-BR')}): pontos não exibidos no mapa; tabela e exportação estão completas.`, 'info', 6000); return; }
            if (!state.extractGroup) state.extractGroup = new L.LayerGroup().addTo(map);
            if (!state.extractRenderer) state.extractRenderer = L.canvas({ padding: 0.5 });
            rows.forEach(r => {
                const dd = `${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}`;
                const m = L.circleMarker([r.lat, r.lng], { renderer: state.extractRenderer, radius: 4.5, color: '#7c2d12', weight: 1.5, fillColor: '#fb923c', fillOpacity: 1, bubblingMouseEvents: false });
                m.bindTooltip(`<b>${esc(r.nome)} · ${r.anel}.V${r.v}</b><br>Lat/Lon: ${dd}<br>UTM 22S: E ${r.e} N ${r.n}<br><small>Clique para copiar</small>`, { direction: 'top', offset: [0, -4] });
                m.on('click', () => copyText(dd));
                state.extractGroup.addLayer(m);
            });
        }
    }

    function describeLayer(l) {
        const rows = [];
        if (l._note) rows.push(`<b>${esc(l._note)}</b>`);
        if (l instanceof L.Circle) {
            const r = l.getRadius();
            rows.push(`Raio: ${fmtDist(r)}`, `Área: ${fmtArea(Math.PI * r * r)}`);
        } else if (l instanceof L.Marker) {
            const ll = l.getLatLng(); const u = toUTM22S(ll.lat, ll.lng);
            rows.push(`Lat/Lon: ${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}`, `UTM 22S: E ${u.x} N ${u.y}`);
        } else if (l instanceof L.Polygon) {
            const ring = l.getLatLngs()[0];
            const area = calculateApproxArea({ type: 'Polygon', coordinates: [ring.map(p => [p.lng, p.lat]).concat([[ring[0].lng, ring[0].lat]])] });
            let per = 0;
            for (let i = 0; i < ring.length; i++) per += ring[i].distanceTo(ring[(i + 1) % ring.length]);
            rows.push(`Área: ${fmtArea(area)}`, `Perímetro: ${fmtDist(per)}`);
        } else if (l instanceof L.Polyline) {
            const pts = l.getLatLngs(); let d = 0;
            for (let i = 0; i < pts.length - 1; i++) d += pts[i].distanceTo(pts[i + 1]);
            rows.push(`Comprimento: ${fmtDist(d)}`);
        }
        return rows.join('<br>');
    }

    function summaryText(l) {
        if (l instanceof L.Circle) return `Raio ${fmtDist(l.getRadius())} · ${fmtArea(Math.PI * l.getRadius() ** 2)}`;
        if (l instanceof L.Marker) {
            const ll = l.getLatLng();
            return l._isText ? 'Rótulo de texto' : `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;
        }
        if (l instanceof L.Polygon) {
            const ring = l.getLatLngs()[0];
            const area = calculateApproxArea({ type: 'Polygon', coordinates: [ring.map(p => [p.lng, p.lat]).concat([[ring[0].lng, ring[0].lat]])] });
            let per = 0;
            for (let i = 0; i < ring.length; i++) per += ring[i].distanceTo(ring[(i + 1) % ring.length]);
            return `${fmtArea(area)} · Perím. ${fmtDist(per)}`;
        }
        if (l instanceof L.Polyline) {
            const pts = l.getLatLngs(); let d = 0;
            for (let i = 0; i < pts.length - 1; i++) d += pts[i].distanceTo(pts[i + 1]);
            return `Comp. ${fmtDist(d)}`;
        }
        return '';
    }

    function buildDrawPanel(body) {
        body.innerHTML = `
            <div class="tp-sub" style="margin-top:0;">1. Escolha a ferramenta de desenho</div>
            <div class="draw-tools-grid">
                <button type="button" class="draw-tool-btn" data-dmode="line"><i class="fa-solid fa-slash"></i><span>Linha</span></button>
                <button type="button" class="draw-tool-btn" data-dmode="polygon"><i class="fa-solid fa-draw-polygon"></i><span>Polígono</span></button>
                <button type="button" class="draw-tool-btn" data-dmode="rect"><i class="fa-regular fa-square"></i><span>Retângulo</span></button>
                <button type="button" class="draw-tool-btn" data-dmode="circle"><i class="fa-regular fa-circle"></i><span>Círculo</span></button>
                <button type="button" class="draw-tool-btn" data-dmode="marker"><i class="fa-solid fa-location-dot"></i><span>Ponto</span></button>
                <button type="button" class="draw-tool-btn" data-dmode="text"><i class="fa-solid fa-font"></i><span>Texto</span></button>
            </div>

            <div class="tp-sub">2. Estilo e Rótulo (opcional)</div>
            <div class="tp-row">
                <input type="text" id="draw-label-input" class="tp-input" placeholder="Texto ou nome do desenho (ex.: Lote 12, Recuo 5m)...">
            </div>
            <div class="draw-colors" id="draw-colors">
                <span class="draw-color-lbl">Cor:</span>
                <button type="button" class="color-swatch active" data-color="#e63946" style="background:#e63946;" title="Vermelho"></button>
                <button type="button" class="color-swatch" data-color="#00a896" style="background:#00a896;" title="Verde-água"></button>
                <button type="button" class="color-swatch" data-color="#0d3b66" style="background:#0d3b66;" title="Azul"></button>
                <button type="button" class="color-swatch" data-color="#d97706" style="background:#d97706;" title="Laranja"></button>
                <button type="button" class="color-swatch" data-color="#7c3aed" style="background:#7c3aed;" title="Roxo"></button>
                <button type="button" class="color-swatch" data-color="#111827" style="background:#111827;" title="Preto"></button>
            </div>

            <div class="tp-sub">Aderência (Snap Magnético)</div>
            <label class="tp-check"><input type="checkbox" id="snap-on" checked> Ativar aderência automática a vértices e arestas</label>
            <div class="tp-row two">
                <select id="snap-mode" class="tp-input">
                    <option value="both" selected>Vértices e arestas</option>
                    <option value="vertex">Somente vértices</option>
                </select>
                <select id="snap-tol" class="tp-input">
                    <option value="12">Alcance 12 px (Mais fino)</option>
                    <option value="18" selected>Alcance 18 px (Recomendado)</option>
                    <option value="26">Alcance 26 px (Mais forte)</option>
                </select>
            </div>
            <div class="tp-hint">O cursor "gruda" com precisão nos vértices (anel magenta) ou arestas (anel violeta) das camadas ativas e desenhos. Ao desenhar polígonos, clicar ou aproximar do 1º vértice fecha o polígono automaticamente.</div>

            <div id="draw-live-box" class="draw-live-box" style="display:none;">
                <div id="draw-live-hint" class="draw-live-hint">Clique no mapa para iniciar...</div>
                <div id="draw-live-metric" class="draw-live-metric"></div>
                <div class="draw-live-snap-row">
                    <span style="color:var(--text-muted);font-weight:600;"><i class="fa-solid fa-magnet"></i> Aderência:</span>
                    <button type="button" id="draw-snap-toggle" class="draw-snap-pill active" title="Alternar aderência magnética">
                        <i class="fa-solid fa-magnet"></i> <span id="draw-snap-status">Ativa (18px)</span>
                    </button>
                </div>
                <div style="display:flex;gap:4px;margin-top:6px;margin-bottom:0;align-items:center;">
                    <button type="button" class="tp-btn primary" id="draw-btn-finish" style="flex:1;"><i class="fa-solid fa-check"></i> Concluir</button>
                    <button type="button" class="tp-btn" id="draw-btn-undo" title="Desfazer" style="padding:6px 10px;"><i class="fa-solid fa-rotate-left"></i></button>
                    <button type="button" class="tp-btn" id="draw-btn-redo" title="Refazer" style="padding:6px 10px;"><i class="fa-solid fa-rotate-right"></i></button>
                    <button type="button" class="tp-btn danger" id="draw-btn-cancel" style="flex:1;"><i class="fa-solid fa-xmark"></i> Cancelar</button>
                </div>
            </div>

            <div class="tp-sub" style="display:flex;justify-content:space-between;align-items:center;">
                <span>Desenhos no Mapa (<span id="draw-count">0</span>)</span>
                <div style="display:inline-flex;gap:4px;">
                    <button type="button" class="tp-btn" id="draw-global-undo" title="Desfazer" style="padding:2px 8px;font-size:0.75rem;"><i class="fa-solid fa-rotate-left"></i></button>
                    <button type="button" class="tp-btn" id="draw-global-redo" title="Refazer" style="padding:2px 8px;font-size:0.75rem;"><i class="fa-solid fa-rotate-right"></i></button>
                </div>
            </div>
            <div id="draw-items-list" class="draw-items-list">
                <div class="tp-hint">Nenhum desenho adicionado ainda. Selecione uma ferramenta acima e clique no mapa.</div>
            </div>

            <div class="tp-sub">Vértices e Coordenadas</div>
            <label class="tp-check"><input type="checkbox" id="vx-show" checked> Mostrar vértices (passe o mouse para ver as coordenadas)</label>
            <div class="tp-row"><button type="button" class="tp-btn primary" id="vx-gen"><i class="fa-solid fa-table-list"></i> Gerar coordenadas de todos os vértices</button></div>
            <div id="vx-out"></div>

            <div class="tp-sub">Exportar Desenhos</div>
            <div class="tp-row three">
                <button type="button" class="tp-btn" id="ex-geojson"><i class="fa-solid fa-file-code"></i> GeoJSON</button>
                <button type="button" class="tp-btn" id="ex-kml"><i class="fa-solid fa-earth-americas"></i> KML</button>
                <button type="button" class="tp-btn" id="ex-png"><i class="fa-solid fa-image"></i> PNG</button>
            </div>
            <div class="tp-row"><button type="button" class="tp-btn danger" id="ex-clear"><i class="fa-solid fa-trash-can"></i> Apagar todos os desenhos</button></div>`;

        body.querySelectorAll('.draw-tool-btn').forEach(b => {
            b.addEventListener('click', () => {
                const m = b.getAttribute('data-dmode');
                if (state.drawMode === m) stopActiveDraw();
                else startDrawMode(m);
            });
        });

        body.querySelectorAll('.color-swatch').forEach(sw => {
            sw.addEventListener('click', () => {
                body.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
                sw.classList.add('active');
                state.drawColor = sw.getAttribute('data-color');
            });
        });

        function updateSnapUI() {
            if ($('snap-on')) $('snap-on').checked = state.snapOn;
            const toggle = $('draw-snap-toggle');
            const status = $('draw-snap-status');
            if (toggle) toggle.classList.toggle('active', state.snapOn);
            if (status) status.textContent = state.snapOn ? `Ativa (${state.snapTol}px)` : 'Desativada';
            if (!state.snapOn) {
                state.activeSnap = null;
                showSnapMarker(null);
            }
        }

        $('draw-btn-finish').addEventListener('click', finishActiveDraw);
        $('snap-on').checked = state.snapOn;
        $('snap-mode').value = state.snapMode;
        $('snap-tol').value = String(state.snapTol);
        $('snap-on').addEventListener('change', e => {
            state.snapOn = e.target.checked;
            updateSnapUI();
            toast(state.snapOn ? `Aderência ativada (${state.snapTol}px).` : 'Aderência desativada.', 'info', 1600);
        });
        const snapToggleBtn = $('draw-snap-toggle');
        if (snapToggleBtn) {
            snapToggleBtn.addEventListener('click', () => {
                state.snapOn = !state.snapOn;
                updateSnapUI();
                toast(state.snapOn ? `Aderência ativada (${state.snapTol}px).` : 'Aderência desativada.', 'info', 1600);
            });
        }
        $('snap-mode').addEventListener('change', e => { state.snapMode = e.target.value; });
        $('snap-tol').addEventListener('change', e => {
            state.snapTol = parseInt(e.target.value, 10) || 18;
            updateSnapUI();
        });
        updateSnapUI();
        $('vx-show').checked = state.showVerts;
        $('vx-show').addEventListener('change', e => { state.showVerts = e.target.checked; refreshVertices(); });
        $('vx-gen').addEventListener('click', buildCoordTable);
        if ($('draw-btn-undo')) $('draw-btn-undo').addEventListener('click', undoDrawPoint);
        if ($('draw-btn-redo')) $('draw-btn-redo').addEventListener('click', redoDrawPoint);
        if ($('draw-btn-cancel')) $('draw-btn-cancel').addEventListener('click', stopActiveDraw);
        if ($('draw-global-undo')) $('draw-global-undo').addEventListener('click', undoLastDrawn);
        if ($('draw-global-redo')) $('draw-global-redo').addEventListener('click', redoLastDrawn);

        const need = () => {
            const fc = drawnToGeoJSON();
            if (!fc.features.length) { toast('Crie ao menos 1 desenho no mapa antes de exportar.', 'err'); return null; }
            return fc;
        };
        $('ex-geojson').addEventListener('click', () => { const fc = need(); if (fc) download('desenhos_matinhos.geojson', JSON.stringify(fc, null, 2), 'application/geo+json'); });
        $('ex-kml').addEventListener('click', () => { const fc = need(); if (fc) download('desenhos_matinhos.kml', toKML(fc, 'Desenhos - Geoportal de Matinhos'), 'application/vnd.google-earth.kml+xml'); });
        $('ex-png').addEventListener('click', exportPNG);
        $('ex-clear').addEventListener('click', () => {
            if (state.drawnItems && state.drawnItems.getLayers().length) {
                state.drawnItems.clearLayers();
                state.drawnList = [];
                renderDrawnList();
                toast('Todos os desenhos foram removidos.', 'info');
            }
        });
        renderDrawnList();
    }

    function onDrawPanelOpen() {
        ensureDrawnGroup();
    }

    function startDrawMode(mode) {
        stopActiveDraw();
        ensureDrawnGroup();
        state.drawMode = mode;
        state.drawPts = [];
        window.GEO_TOOL_BUSY = true;
        map.doubleClickZoom.disable();
        map.getContainer().classList.add('pick-cursor');

        document.querySelectorAll('.draw-tool-btn').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-dmode') === mode);
        });

        const box = $('draw-live-box');
        const hint = $('draw-live-hint');
        const metric = $('draw-live-metric');
        const finishBtn = $('draw-btn-finish');
        const undoBtn = $('draw-btn-undo');
        const redoBtn = $('draw-btn-redo');
        if (box) box.style.display = 'block';
        if (metric) metric.textContent = '';
        state.drawRedoPts = [];

        const hints = {
            line: 'Clique no mapa para adicionar pontos da linha. Clique em "Concluir" (ou duplo-clique) para encerrar.',
            polygon: 'Clique nos vértices do polígono. Clique em "Concluir" (ou duplo-clique) para fechar.',
            rect: 'Clique no 1º canto do retângulo e depois no canto oposto.',
            circle: 'Clique no centro do círculo e depois na borda para definir o raio.',
            marker: 'Clique no ponto desejado do mapa para inserir o marcador.',
            text: 'Digite o texto no campo acima e clique no mapa onde deseja fixar o rótulo.'
        };
        if (hint) hint.textContent = hints[mode] || 'Clique no mapa...';
        if (finishBtn) finishBtn.style.display = (mode === 'line' || mode === 'polygon') ? 'inline-block' : 'none';
        if (undoBtn) undoBtn.style.display = (mode === 'line' || mode === 'polygon') ? 'inline-block' : 'none';
        if (redoBtn) redoBtn.style.display = (mode === 'line' || mode === 'polygon') ? 'inline-block' : 'none';

        map.on('click', onDrawMapClick);
        map.on('mousemove', onDrawMapMove);
        map.on('dblclick', onDrawMapDblClick);
    }

    function stopActiveDraw() {
        map.off('click', onDrawMapClick);
        map.off('mousemove', onDrawMapMove);
        map.off('dblclick', onDrawMapDblClick);
        state.activeSnap = null;
        showSnapMarker(null);
        if (state.drawPreview) { state.drawPreview.remove(); state.drawPreview = null; }
        if (state.drawVerts) state.drawVerts.clearLayers();
        state.drawMode = null;
        state.drawPts = [];
        state.drawRedoPts = [];
        window.GEO_TOOL_BUSY = !!state.pickHandler;
        map.getContainer().classList.remove('pick-cursor');
        setTimeout(() => { if (map && map.doubleClickZoom) map.doubleClickZoom.enable(); }, 150);

        document.querySelectorAll('.draw-tool-btn').forEach(b => b.classList.remove('active'));
        const box = $('draw-live-box');
        if (box) box.style.display = 'none';
    }

    function undoDrawPoint() {
        if (!state.drawPts.length) return;
        const pt = state.drawPts.pop();
        state.drawRedoPts.push(pt);
        redrawVertices();
        updateLivePreview(null);
    }

    function redoDrawPoint() {
        if (!state.drawRedoPts.length) return;
        const pt = state.drawRedoPts.pop();
        state.drawPts.push(pt);
        redrawVertices();
        updateLivePreview(null);
    }

    function redrawVertices() {
        if (!state.drawVerts) return;
        state.drawVerts.clearLayers();
        state.drawPts.forEach((pt, idx) => {
            L.circleMarker(pt, {
                radius: idx === 0 ? 6 : 4.5,
                color: '#ffffff',
                fillColor: state.drawColor,
                fillOpacity: 1,
                weight: 2
            }).addTo(state.drawVerts);
        });
    }

    function updateLivePreview(cursorLatLng) {
        if (state.drawPreview) { state.drawPreview.remove(); state.drawPreview = null; }
        const pts = cursorLatLng ? state.drawPts.concat([cursorLatLng]) : state.drawPts.slice();
        const metric = $('draw-live-metric');
        const col = state.drawColor;

        if (state.drawMode === 'line' && pts.length >= 2) {
            state.drawPreview = L.polyline(pts, { color: col, weight: 3, dashArray: '6, 4' }).addTo(map);
            let d = 0;
            for (let i = 0; i < pts.length - 1; i++) d += pts[i].distanceTo(pts[i + 1]);
            if (metric) metric.textContent = `Pontos: ${state.drawPts.length} · Comprimento: ${fmtDist(d)}`;
        } else if (state.drawMode === 'polygon' && pts.length >= 2) {
            state.drawPreview = L.polygon(pts, { color: col, weight: 2.5, fillColor: col, fillOpacity: 0.22, dashArray: '6, 4' }).addTo(map);
            if (pts.length >= 3) {
                const area = calculateApproxArea({ type: 'Polygon', coordinates: [pts.map(p => [p.lng, p.lat]).concat([[pts[0].lng, pts[0].lat]])] });
                let per = 0;
                for (let i = 0; i < pts.length; i++) per += pts[i].distanceTo(pts[(i + 1) % pts.length]);
                if (metric) metric.textContent = `Vértices: ${state.drawPts.length} · Área: ${fmtArea(area)} · Perímetro: ${fmtDist(per)}`;
            } else if (metric) {
                metric.textContent = `Vértices: ${state.drawPts.length} (adicione ao menos 3 pontos)`;
            }
        } else if (state.drawMode === 'rect' && state.drawPts.length === 1 && cursorLatLng) {
            const bounds = L.latLngBounds(state.drawPts[0], cursorLatLng);
            state.drawPreview = L.rectangle(bounds, { color: col, weight: 2.5, fillColor: col, fillOpacity: 0.22, dashArray: '6, 4' }).addTo(map);
            const ring = [bounds.getSouthWest(), bounds.getNorthWest(), bounds.getNorthEast(), bounds.getSouthEast()];
            const area = calculateApproxArea({ type: 'Polygon', coordinates: [ring.map(p => [p.lng, p.lat]).concat([[ring[0].lng, ring[0].lat]])] });
            if (metric) metric.textContent = `Área: ${fmtArea(area)}`;
        } else if (state.drawMode === 'circle' && state.drawPts.length === 1 && cursorLatLng) {
            const r = state.drawPts[0].distanceTo(cursorLatLng);
            state.drawPreview = L.circle(state.drawPts[0], { radius: r, color: col, weight: 2.5, fillColor: col, fillOpacity: 0.22, dashArray: '6, 4' }).addTo(map);
            if (metric) metric.textContent = `Raio: ${fmtDist(r)} · Área: ${fmtArea(Math.PI * r * r)}`;
        }
    }

    function registerDrawnLayer(layer, defaultTypeLabel) {
        const labelInput = $('draw-label-input');
        const userNote = labelInput ? labelInput.value.trim() : '';
        const id = state.drawSeq++;
        layer._drawId = id;
        layer._typeLabel = defaultTypeLabel;
        layer._note = userNote || `${defaultTypeLabel} #${id}`;
        layer._color = state.drawColor;

        if (userNote && !layer._isText) {
            layer.bindTooltip(esc(userNote), { permanent: true, direction: 'top', className: 'draw-note' });
        }
        layer.bindPopup(() => describeLayer(layer));
        state.drawnItems.addLayer(layer);
        state.drawnList.push(layer);
        state.drawnRedoStack = [];
        if (labelInput && !layer._isText) labelInput.value = '';
        renderDrawnList();
        toast(`${defaultTypeLabel} adicionado ao mapa!`, 'ok', 2200);
    }

    function undoLastDrawn() {
        if (state.drawMode && (state.drawMode === 'line' || state.drawMode === 'polygon')) {
            undoDrawPoint();
            return;
        }
        if (!state.drawnList.length) return;
        const last = state.drawnList.pop();
        state.drawnItems.removeLayer(last);
        state.drawnRedoStack.push(last);
        renderDrawnList();
    }

    function redoLastDrawn() {
        if (state.drawMode && (state.drawMode === 'line' || state.drawMode === 'polygon')) {
            redoDrawPoint();
            return;
        }
        if (!state.drawnRedoStack.length) return;
        const restored = state.drawnRedoStack.pop();
        state.drawnItems.addLayer(restored);
        state.drawnList.push(restored);
        renderDrawnList();
    }

    function onDrawMapClick(e) {
        if (!state.drawMode) return;
        const snapCandidate = state.snapOn ? (state.activeSnap || findSnap(e.latlng)) : null;
        const ll = snapCandidate ? snapCandidate.ll : e.latlng;
        const col = state.drawColor;

        if (state.drawMode === 'marker') {
            const m = L.marker(ll);
            registerDrawnLayer(m, 'Ponto');
            m.openPopup();
            stopActiveDraw();
            return;
        }

        if (state.drawMode === 'text') {
            const inp = $('draw-label-input');
            const txt = (inp && inp.value.trim()) ? inp.value.trim() : 'Anotação #' + state.drawSeq;
            const icon = L.divIcon({
                className: 'map-text-annotation',
                html: `<div class="map-text-box" style="border-color:${col};color:${col};">${esc(txt)}</div>`,
                iconSize: null
            });
            const m = L.marker(ll, { icon });
            m._isText = true;
            registerDrawnLayer(m, 'Texto');
            if (inp) inp.value = '';
            stopActiveDraw();
            return;
        }

        if (state.drawMode === 'rect') {
            state.drawPts.push(ll);
            redrawVertices();
            if (state.drawPts.length >= 2) {
                const bounds = L.latLngBounds(state.drawPts[0], state.drawPts[1]);
                const rect = L.rectangle(bounds, { color: col, weight: 3, fillColor: col, fillOpacity: 0.25 });
                registerDrawnLayer(rect, 'Retângulo');
                stopActiveDraw();
            }
            return;
        }

        if (state.drawMode === 'circle') {
            state.drawPts.push(ll);
            redrawVertices();
            if (state.drawPts.length >= 2) {
                const r = Math.max(1, state.drawPts[0].distanceTo(state.drawPts[1]));
                const cir = L.circle(state.drawPts[0], { radius: r, color: col, weight: 3, fillColor: col, fillOpacity: 0.25 });
                registerDrawnLayer(cir, 'Círculo');
                stopActiveDraw();
            }
            return;
        }

        // 'line' ou 'polygon'
        if (state.drawMode === 'polygon' && state.drawPts.length >= 3) {
            const p0 = state.drawPts[0];
            const p0Point = map.latLngToContainerPoint(p0);
            const clickPoint = map.latLngToContainerPoint(ll);
            const rawClickPoint = map.latLngToContainerPoint(e.latlng);
            const tol = Math.max(state.snapTol || 18, 18);
            if (clickPoint.distanceTo(p0Point) <= 1 || rawClickPoint.distanceTo(p0Point) <= (tol + 5) || (snapCandidate && snapCandidate.isStartPoint)) {
                finishActiveDraw();
                return;
            }
        }

        // Se clicou muito próximo do último ponto (ex: segundo clique de um duplo clique), ignora duplicata
        if (state.drawPts.length > 0) {
            const last = state.drawPts[state.drawPts.length - 1];
            if (map.latLngToContainerPoint(last).distanceTo(map.latLngToContainerPoint(ll)) < 5) {
                return;
            }
        }
        state.drawPts.push(ll);
        state.drawRedoPts = [];
        redrawVertices();
        updateLivePreview(null);
    }

    function onDrawMapMove(e) {
        if (!state.drawMode) return;
        const t = state.snapOn ? findSnap(e.latlng) : null;
        state.activeSnap = t;
        showSnapMarker(t);
        if (!state.drawPts.length) return;
        updateLivePreview(t ? t.ll : e.latlng);
    }

    function onDrawMapDblClick(e) {
        if (!state.drawMode) return;
        L.DomEvent.stopPropagation(e);
        if (state.drawMode === 'line' || state.drawMode === 'polygon') {
            finishActiveDraw();
        }
    }

    function finishActiveDraw() {
        const col = state.drawColor;
        if (state.drawMode === 'line') {
            if (state.drawPts.length < 2) { toast('Clique em pelo menos 2 pontos no mapa para criar a linha.', 'err'); return; }
            const poly = L.polyline(state.drawPts, { color: col, weight: 3.5 });
            registerDrawnLayer(poly, 'Linha');
            stopActiveDraw();
        } else if (state.drawMode === 'polygon') {
            if (state.drawPts.length < 3) { toast('Clique em pelo menos 3 vértices no mapa para fechar o polígono.', 'err'); return; }
            const pg = L.polygon(state.drawPts, { color: col, weight: 3, fillColor: col, fillOpacity: 0.25 });
            registerDrawnLayer(pg, 'Polígono');
            stopActiveDraw();
        }
    }

    function renderDrawnList() {
        refreshVertices();
        const countEl = $('draw-count');
        const listEl = $('draw-items-list');
        if (countEl) countEl.textContent = String(state.drawnList.length);
        if (!listEl) return;
        if (!state.drawnList.length) {
            listEl.innerHTML = `<div class="tp-hint">Nenhum desenho adicionado ainda. Selecione uma ferramenta acima e clique no mapa.</div>`;
            return;
        }
        listEl.innerHTML = '';
        state.drawnList.forEach(l => {
            const row = document.createElement('div');
            row.className = 'draw-item-row';
            row.innerHTML = `
                <div class="draw-item-info">
                    <b><span class="draw-dot" style="background:${esc(l._color || '#e63946')}"></span>${esc(l._note || l._typeLabel)}</b>
                    <small>${esc(summaryText(l))}</small>
                </div>
                <div class="draw-item-actions">
                    <button type="button" class="mini-act" title="Centralizar no mapa"><i class="fa-solid fa-magnifying-glass"></i></button>
                    <button type="button" class="mini-act del" title="Excluir este desenho"><i class="fa-solid fa-trash-can"></i></button>
                </div>`;
            const [btnZoom, btnDel] = row.querySelectorAll('button');
            btnZoom.addEventListener('click', () => {
                if (l.getBounds) map.fitBounds(l.getBounds(), { padding: [60, 60], maxZoom: 18 });
                else if (l.getLatLng) map.flyTo(l.getLatLng(), 18);
                if (l.openPopup) l.openPopup();
            });
            btnDel.addEventListener('click', () => {
                state.drawnItems.removeLayer(l);
                state.drawnList = state.drawnList.filter(x => x !== l);
                renderDrawnList();
            });
            listEl.appendChild(row);
        });
    }

    function drawnToGeoJSON() {
        const fc = { type: 'FeatureCollection', features: [] };
        if (!state.drawnItems) return fc;
        state.drawnItems.eachLayer(l => {
            const f = l.toGeoJSON();
            f.properties = Object.assign({}, f.properties, {
                nome: l._note || '',
                tipo: l._typeLabel || '',
                cor: l._color || '#e63946',
                medida: summaryText(l)
            });
            if (l instanceof L.Circle) f.properties.raio_m = l.getRadius();
            fc.features.push(f);
        });
        return fc;
    }

    const xml = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
    const kmlCoords = arr => arr.map(c => `${c[0]},${c[1]},0`).join(' ');
    function geomKML(g) {
        switch (g.type) {
            case 'Point': return `<Point><coordinates>${g.coordinates[0]},${g.coordinates[1]},0</coordinates></Point>`;
            case 'LineString': return `<LineString><tessellate>1</tessellate><coordinates>${kmlCoords(g.coordinates)}</coordinates></LineString>`;
            case 'Polygon': return `<Polygon>${g.coordinates.map((r, i) => `<${i ? 'inner' : 'outer'}BoundaryIs><LinearRing><coordinates>${kmlCoords(r)}</coordinates></LinearRing></${i ? 'inner' : 'outer'}BoundaryIs>`).join('')}</Polygon>`;
            default: return '';
        }
    }
    function toKML(fc, name) {
        const pm = fc.features.map((f, i) => `<Placemark><name>${xml(f.properties.nome || 'Desenho ' + (i + 1))}</name><description>${xml(f.properties.medida || '')}</description>${geomKML(f.geometry)}</Placemark>`).join('');
        return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(name)}</name>${pm}</Document></kml>`;
    }

    function exportPNG() {
        if (typeof html2canvas !== 'function') { toast('Biblioteca de captura não carregada.', 'err'); return; }
        toast('Gerando imagem PNG...', 'info', 1800);
        html2canvas($('map'), { useCORS: true, logging: false, ignoreElements: el => el.classList && (el.classList.contains('leaflet-control-container')) })
            .then(c => c.toBlob(b => {
                const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'mapa_matinhos.png';
                document.body.appendChild(a); a.click(); a.remove();
                toast('PNG exportado com sucesso!', 'ok', 4000);
            }))
            .catch(() => toast('Não foi possível gerar o PNG com este mapa base. Use Imprimir Mapa > Salvar como PDF.', 'err', 5000));
    }

    /* ---------- LAYOUT DE IMPRESSÃO INTERATIVO (CROQUI COM ENQUADRAMENTO MÓVEL) ---------- */
    function buildPrintPanel(body) {
        body.innerHTML = `
            <div class="pr-guide-banner">
                <i class="fa-solid fa-arrows-up-down-left-right"></i>
                <div>
                    <b>Enquadramento Interativo Ativo:</b><br>
                    Arraste o mapa diretamente dentro da folha ao lado (ou use as setas abaixo) para posicionar a imagem ideal para impressão.
                </div>
            </div>
            <div class="tp-sub" style="margin-top:4px;"><i class="fa-solid fa-heading"></i> 1. Identificação do Croqui</div>
            <div class="tp-row"><input type="text" id="pr-title" class="tp-input" value="Geoportal de Matinhos" placeholder="Título do croqui / mapa"></div>
            <div class="tp-row"><input type="text" id="pr-sub" class="tp-input" placeholder="Subtítulo, lote, inscrição ou observação (opcional)"></div>

            <div class="tp-sub"><i class="fa-solid fa-file-lines"></i> 2. Formato da Folha</div>
            <div class="tp-row two">
                <select id="pr-paper" class="tp-input" title="Tamanho do papel">
                    <option value="A4">Folha A4</option>
                    <option value="A3">Folha A3</option>
                </select>
                <select id="pr-orient" class="tp-input" title="Orientação da folha">
                    <option value="landscape">Paisagem (Horizontal)</option>
                    <option value="portrait">Retrato (Vertical)</option>
                </select>
            </div>

            <div class="tp-sub"><i class="fa-solid fa-up-down-left-right"></i> 3. Mover e Ajustar Imagem no Croqui</div>
            <div class="pr-nav-box">
                <div class="pr-pan-grid">
                    <span></span>
                    <button type="button" class="pr-nav-btn" data-pan="0,-90" title="Mover imagem para cima (Norte)"><i class="fa-solid fa-arrow-up"></i></button>
                    <span></span>
                    <button type="button" class="pr-nav-btn" data-pan="-90,0" title="Mover imagem para a esquerda (Oeste)"><i class="fa-solid fa-arrow-left"></i></button>
                    <button type="button" class="pr-nav-btn pr-nav-center" id="pr-btn-recenter" title="Manter centro atual"><i class="fa-solid fa-crosshairs"></i></button>
                    <button type="button" class="pr-nav-btn" data-pan="90,0" title="Mover imagem para a direita (Leste)"><i class="fa-solid fa-arrow-right"></i></button>
                    <span></span>
                    <button type="button" class="pr-nav-btn" data-pan="0,90" title="Mover imagem para baixo (Sul)"><i class="fa-solid fa-arrow-down"></i></button>
                    <span></span>
                </div>
                <div class="pr-zoom-col">
                    <button type="button" class="tp-btn" id="pr-zoom-in"><i class="fa-solid fa-magnifying-glass-plus"></i> Aproximar (+)</button>
                    <button type="button" class="tp-btn" id="pr-zoom-out"><i class="fa-solid fa-magnifying-glass-minus"></i> Afastar (−)</button>
                    <div class="pr-live-metrics">
                        <span>Escala: <b id="pr-scale-live">1:5.000</b></span>
                        <span id="pr-coord-live">Centro UTM</span>
                    </div>
                </div>
            </div>

            <div class="tp-sub"><i class="fa-solid fa-list"></i> 4. Legenda no Croqui</div>
            <div class="tp-row two" style="align-items:center;">
                <label class="tp-check" style="margin:0;"><input type="checkbox" id="pr-legend" checked> Exibir legenda</label>
                <select id="pr-legend-pos" class="tp-input" title="Posição da legenda no croqui">
                    <option value="bl">Canto Inf. Esquerdo</option>
                    <option value="br">Canto Inf. Direito</option>
                    <option value="tl">Canto Sup. Esquerdo</option>
                </select>
            </div>

            <div class="tp-row" style="margin-top:10px; display:flex; flex-direction:column; gap:6px;">
                <button type="button" class="tp-btn primary" id="pr-go" style="padding:10px;font-size:0.84rem;">
                    <i class="fa-solid fa-print"></i> Imprimir / Salvar como PDF
                </button>
                <button type="button" class="tp-btn" id="pr-dl-img" style="padding:8px;font-size:0.78rem;background:#00796b;color:#fff;border:none;" title="Baixar imagem direta em PNG">
                    <i class="fa-solid fa-file-image"></i> Baixar Imagem do Croqui (PNG)
                </button>
            </div>
            <p class="tp-hint">O croqui impresso respeitará exatamente o enquadramento posicionado na folha ao lado, incluindo o símbolo oficial da Secretaria Municipal de Urbanismo e Planejamento Urbano no topo direito.</p>`;

        $('pr-go').addEventListener('click', doPrint);
        $('pr-dl-img') && $('pr-dl-img').addEventListener('click', downloadCroquiImage);
        $('pr-title').addEventListener('input', refreshPrintFrameContent);
        $('pr-sub').addEventListener('input', refreshPrintFrameContent);
        $('pr-legend').addEventListener('change', refreshPrintFrameContent);
        $('pr-legend-pos').addEventListener('change', refreshPrintFrameContent);
        $('pr-paper').addEventListener('change', () => {
            updatePrintSheetGeometry(true);
            refreshPrintFrameContent();
        });
        $('pr-orient').addEventListener('change', () => {
            updatePrintSheetGeometry(true);
            refreshPrintFrameContent();
        });

        body.querySelectorAll('[data-pan]').forEach(btn => {
            btn.addEventListener('click', () => {
                const [dx, dy] = btn.getAttribute('data-pan').split(',').map(Number);
                map.panBy([dx, dy], { animate: true, duration: 0.25 });
            });
        });
        $('pr-zoom-in').addEventListener('click', () => map.zoomIn());
        $('pr-zoom-out').addEventListener('click', () => map.zoomOut());
        $('pr-btn-recenter').addEventListener('click', () => {
            toast('Centro do croqui fixado na posição atual!', 'ok', 1600);
            updateLivePrintMetrics();
        });
    }

    function getApproxScale() {
        if (!window.map) return '1:5.000';
        const c = map.getCenter();
        const z = map.getZoom();
        // Metros por pixel na latitude atual (Web Mercator)
        const mPerPx = (156543.03392 * Math.cos(c.lat * Math.PI / 180)) / Math.pow(2, z);
        // 1 metro na tela a 96 DPI = 3779.527559 pixels
        const rawScale = mPerPx * 3779.527559;
        const nice = Math.max(100, Math.round(rawScale / 50) * 50);
        return '1:' + nice.toLocaleString('pt-BR');
    }

    function legendEntries() {
        const items = [];
        Object.entries(layersMap).forEach(([id, g]) => {
            if (!g || !map.hasLayer(g)) return;
            let def = null;
            if (g.eachLayer) g.eachLayer(l => { if (!def && l.layerDef) def = l.layerDef; });
            if (id === 'zoneamento_corrigido') {
                if (typeof currentZoneFilter !== 'undefined' && currentZoneFilter !== 'ALL' && ZONE_CONFIG[currentZoneFilter]) {
                    const z = ZONE_CONFIG[currentZoneFilter];
                    items.push({ color: z.color, label: z.label });
                } else {
                    Object.values(ZONE_CONFIG).forEach(z => items.push({ color: z.color, label: z.label }));
                }
            } else if (id === 'loteamento_por_bairro') {
                items.push({ color: 'linear-gradient(45deg,#d7191c,#fdae61,#abdda4,#2b83ba)', label: (def && def.title) || 'Loteamentos por Bairro' });
            } else if (def) {
                items.push({ color: def.fillColor || def.color || '#888', label: def.title, border: def.color });
            }
        });
        return items;
    }

    function ensurePrintFrame() {
        let fr = $('print-frame');
        if (!fr) {
            fr = document.createElement('div');
            fr.id = 'print-frame';
            const wrap = document.querySelector('.main-wrapper') || document.body;
            wrap.appendChild(fr);
        }
        return fr;
    }

    function updateLivePrintMetrics() {
        if (!window.map) return;
        if (!state.isAdjustingSheet && !state.isPrintingNow) {
            const c = map.getCenter();
            const z = map.getZoom();
            state.printLock = { center: L.latLng(c.lat, c.lng), zoom: z };
        }
        const lockC = (state.printLock && state.printLock.center) ? state.printLock.center : map.getCenter();
        const scaleTxt = getApproxScale();
        const u = toUTM22S(lockC.lat, lockC.lng);

        const elScale = $('pf-live-scale');
        if (elScale) elScale.textContent = scaleTxt;
        const elPanelScale = $('pr-scale-live');
        if (elPanelScale) elPanelScale.textContent = scaleTxt;

        const elCoordPanel = $('pr-coord-live');
        if (elCoordPanel) elCoordPanel.textContent = `E ${u.x} · N ${u.y}`;

        const elFootCoords = $('pf-live-coords');
        if (elFootCoords) {
            elFootCoords.textContent = `Centro do Croqui: UTM 22S E ${u.x} m, N ${u.y} m (${lockC.lat.toFixed(5)}°, ${lockC.lng.toFixed(5)}°)`;
        }
    }

    function refreshPrintFrameContent() {
        const fr = ensurePrintFrame();
        const title = ($('pr-title') && $('pr-title').value.trim()) ? $('pr-title').value.trim() : 'Geoportal de Matinhos';
        const sub = ($('pr-sub') && $('pr-sub').value.trim()) ? $('pr-sub').value.trim() : 'Croqui de Localização e Consulta Territorial';
        const showLeg = $('pr-legend') ? $('pr-legend').checked : true;
        const legPos = $('pr-legend-pos') ? $('pr-legend-pos').value : 'bl';
        const entries = legendEntries();
        const legendHtml = (showLeg && entries.length)
            ? `<div class="pf-legend pf-leg-${esc(legPos)}"><b>Legenda</b>${entries.map(i => `<div><span style="background:${i.color};${i.border ? 'border:1px solid ' + i.border : ''}"></span>${esc(i.label)}</div>`).join('')}</div>`
            : '';
        const who = GeoAuth.isStaff() ? `Servidor: ${esc(GeoAuth.email())} (Uso Interno)` : 'Consulta Pública';
        const scaleTxt = getApproxScale();
        const c = map ? map.getCenter() : { lat: -25.8175, lng: -48.536 };
        const u = toUTM22S(c.lat, c.lng);

        fr.innerHTML = `
            <div class="pf-head">
                <div class="pf-head-left">
                    <div class="pf-title">${esc(title)}</div>
                    <div class="pf-sub">${esc(sub)}</div>
                </div>
                <div class="pf-head-right">
                    <div class="pf-meta">
                        <div class="pf-org">Prefeitura Municipal de Matinhos</div>
                        <div class="pf-sec">Secretaria Municipal de Urbanismo e Planejamento Urbano</div>
                        <div class="pf-meta-line">${new Date().toLocaleDateString('pt-BR')} &bull; ${who} &bull; Escala aprox. <b id="pf-live-scale">${esc(scaleTxt)}</b></div>
                    </div>
                    <div class="pf-logo-card">
                        <img src="img/logo-urbanismo.png" alt="Secretaria Municipal de Urbanismo e Planejamento Urbano" class="pf-logo-img">
                    </div>
                </div>
            </div>
            <div class="pf-map-frame">
                <div class="pf-screen-banner">
                    <i class="fa-solid fa-hand-pointer"></i>
                    <span><b>Enquadramento Interativo:</b> Arraste o mapa com o mouse e use o zoom para posicionar a área ideal no croqui</span>
                </div>
                <div class="pf-north" title="Norte Geográfico">
                    <span>N</span>
                    <i class="fa-solid fa-location-arrow" style="transform: rotate(-45deg);"></i>
                </div>
                <div class="pf-center-cross" title="Centro do Croqui"></div>
                ${legendHtml}
            </div>
            <div class="pf-foot">
                <span>SIRGAS 2000 &bull; <b id="pf-live-coords">Centro do Croqui: UTM 22S E ${u.x} m, N ${u.y} m (${c.lat.toFixed(5)}°, ${c.lng.toFixed(5)}°)</b></span>
                <span>Geoportal Oficial de Matinhos &bull; Documento informativo</span>
            </div>`;
    }

    function getPaperDimsMM() {
        const paper = ($('pr-paper') && $('pr-paper').value) || 'A4';
        const orient = ($('pr-orient') && $('pr-orient').value) || 'landscape';
        // Dimensões úteis descontando margem de 8mm em cada lado
        if (paper === 'A3') {
            return orient === 'landscape'
                ? { w: 404, h: 281, head: 22, foot: 7, paper, orient }
                : { w: 281, h: 404, head: 22, foot: 7, paper, orient };
        }
        return orient === 'landscape'
            ? { w: 281, h: 194, head: 21, foot: 6, paper, orient }
            : { w: 194, h: 281, head: 21, foot: 6, paper, orient };
    }

    function updatePrintSheetGeometry(preserveCenter) {
        if (!state.printPreview || !window.map) return;
        const prevCenter = (preserveCenter && state.printLock && state.printLock.center) ? state.printLock.center : map.getCenter();
        const prevZoom = (preserveCenter && state.printLock && state.printLock.zoom != null) ? state.printLock.zoom : map.getZoom();

        const wrap = document.querySelector('.main-wrapper');
        const wrapW = wrap ? wrap.clientWidth : window.innerWidth;
        const wrapH = wrap ? wrap.clientHeight : (window.innerHeight - 86);

        // Espaço ocupado pela dock + painel aberto à direita
        const rightReserved = (state.panel === 'print' && window.innerWidth > 900) ? 555 : 200;
        const availW = Math.max(300, wrapW - rightReserved - 28);
        const availH = Math.max(240, wrapH - 28);

        const dims = getPaperDimsMM();
        const sheetRatio = dims.w / dims.h;

        let sheetW = availW;
        let sheetH = sheetW / sheetRatio;
        if (sheetH > availH) {
            sheetH = availH;
            sheetW = sheetH * sheetRatio;
        }

        const sheetLeft = Math.max(12, Math.round((availW - sheetW) / 2) + 12);
        const sheetTop = Math.max(10, Math.round((wrapH - sheetH) / 2));
        const headH = Math.max(54, Math.min(72, Math.round(sheetH * (dims.head / dims.h))));
        const footH = Math.max(22, Math.min(30, Math.round(sheetH * (dims.foot / dims.h))));

        const root = document.documentElement;
        root.style.setProperty('--ps-left', sheetLeft + 'px');
        root.style.setProperty('--ps-top', sheetTop + 'px');
        root.style.setProperty('--ps-w', Math.round(sheetW) + 'px');
        root.style.setProperty('--ps-h', Math.round(sheetH) + 'px');
        root.style.setProperty('--ps-head-h', headH + 'px');
        root.style.setProperty('--ps-foot-h', footH + 'px');
        root.style.setProperty('--pr-w', dims.w + 'mm');
        root.style.setProperty('--pr-h', dims.h + 'mm');
        root.style.setProperty('--pr-head-h', dims.head + 'mm');
        root.style.setProperty('--pr-foot-h', dims.foot + 'mm');

        state.isAdjustingSheet = true;
        map.invalidateSize({ animate: false });
        if (map._resetView) {
            map._resetView(prevCenter, prevZoom);
        } else {
            map.setView(prevCenter, prevZoom, { animate: false, reset: true });
        }
        state.isAdjustingSheet = false;
        updateLivePrintMetrics();
    }

    function onPrintPanelOpen() {
        const sb = $('sidebar');
        if (sb && !sb.classList.contains('collapsed')) {
            sb.classList.add('collapsed');
        }
        const c = map.getCenter();
        const z = map.getZoom();
        state.printLock = { center: L.latLng(c.lat, c.lng), zoom: z };
        state.printPreview = true;
        state.isAdjustingSheet = true;
        document.body.classList.add('print-preview-mode');
        refreshPrintFrameContent();
        updatePrintSheetGeometry(true);
        state.isAdjustingSheet = false;

        map.on('move zoomend', updateLivePrintMetrics);
        if (!state._printResizeHandler) {
            state._printResizeHandler = () => {
                if (state.printPreview && !document.body.classList.contains('print-layout')) {
                    updatePrintSheetGeometry(true);
                }
            };
            window.addEventListener('resize', state._printResizeHandler);
        }
    }

    function onPrintPanelClose() {
        if (state.isPrintingNow) return;
        const c = (state.printLock && state.printLock.center) ? L.latLng(state.printLock.center.lat, state.printLock.center.lng) : map.getCenter();
        const z = (state.printLock && state.printLock.zoom != null) ? state.printLock.zoom : map.getZoom();
        state.printPreview = false;
        state.isAdjustingSheet = true;
        document.body.classList.remove('print-preview-mode');
        map.off('move zoomend', updateLivePrintMetrics);
        const fr = $('print-frame');
        if (fr) fr.remove();
        setTimeout(() => {
            if (window.map) {
                map.invalidateSize({ animate: false });
                if (map._resetView) map._resetView(c, z);
                else map.setView(c, z, { animate: false, reset: true });
            }
            state.isAdjustingSheet = false;
        }, 50);
    }

    function syncMapToPrintLock() {
        if (!state.printLock || !window.map) return;
        const targetCenter = L.latLng(state.printLock.center.lat, state.printLock.center.lng);
        const targetZoom = state.printLock.zoom;
        state.isAdjustingSheet = true;
        map.invalidateSize({ animate: false });
        if (map._resetView) {
            map._resetView(targetCenter, targetZoom);
        } else {
            map.setView(targetCenter, targetZoom, { animate: false, reset: true });
        }
        state.isAdjustingSheet = false;
    }

    function doPrint() {
        const c = (state.printLock && state.printLock.center) ? L.latLng(state.printLock.center.lat, state.printLock.center.lng) : map.getCenter();
        const z = (state.printLock && state.printLock.zoom != null) ? state.printLock.zoom : map.getZoom();
        state.printLock = { center: c, zoom: z };

        const dims = getPaperDimsMM();
        let st = $('print-page-style');
        if (!st) { st = document.createElement('style'); st.id = 'print-page-style'; document.head.appendChild(st); }
        st.textContent = `@page { size: ${dims.paper} ${dims.orient}; margin: 8mm; }`;

        const root = document.documentElement;
        root.style.setProperty('--pr-w', dims.w + 'mm');
        root.style.setProperty('--pr-h', dims.h + 'mm');
        root.style.setProperty('--pr-head-h', dims.head + 'mm');
        root.style.setProperty('--pr-foot-h', dims.foot + 'mm');

        refreshPrintFrameContent();

        // Disparo limpo da janela nativa de impressão do navegador
        window.print();
    }

    async function downloadCroquiImage() {
        if (typeof html2canvas === 'undefined') {
            toast('Biblioteca de captura gráfica não carregada.', 'err');
            return;
        }
        const fr = $('print-frame');
        if (!fr) {
            toast('Abra o painel de impressão para visualizar o croqui.', 'err');
            return;
        }
        toast('Preparando imagem do croqui (PNG)...', 'info', 2000);
        try {
            refreshPrintFrameContent();
            const wrap = document.querySelector('.main-wrapper') || document.body;
            const canvas = await html2canvas(wrap, {
                useCORS: true,
                scale: 2,
                logging: false,
                ignoreElements: el => {
                    return el.classList.contains('sidebar') ||
                           el.classList.contains('tools-dock') ||
                           el.id === 'tool-panels' ||
                           el.id === 'floating-layers-btn' ||
                           el.classList.contains('map-floating-drawer-btn') ||
                           el.classList.contains('toast-box') ||
                           el.classList.contains('pf-screen-banner') ||
                           el.classList.contains('leaflet-control-container');
                }
            });
            const link = document.createElement('a');
            link.download = `croqui_matinhos_${new Date().toISOString().slice(0, 10)}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            toast('Imagem do croqui baixada com sucesso!', 'ok');
        } catch (err) {
            console.error('Erro na exportação PNG:', err);
            toast('Para salvar com alta fidelidade, use "Imprimir / Salvar como PDF".', 'info', 4000);
        }
    }

    /* ---------- tela cheia, modo escuro, mini-mapa ---------- */
    function toggleFullscreen() {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => toast('Tela cheia não permitida pelo navegador.', 'err'));
        else document.exitFullscreen();
    }

    function setDark(on) {
        document.body.classList.toggle('dark', on);
        const b = $('dock-dark');
        if (b) {
            b.classList.toggle('active', on);
            b.innerHTML = `<i class="fa-solid ${on ? 'fa-sun' : 'fa-moon'}"></i><span>${on ? 'Modo Claro' : 'Modo Escuro'}</span>`;
        }
        try { localStorage.setItem('geoportal-dark', on ? '1' : '0'); } catch (e) { /* ignore */ }
    }
    function toggleDark() { setDark(!document.body.classList.contains('dark')); }

    function toggleMinimap() {
        const b = $('dock-minimap');
        if (state.minimap) { state.minimap.remove(); state.minimap = null; b.classList.remove('active'); return; }
        if (!(L.Control && L.Control.MiniMap)) { toast('Mini-mapa não carregado (verifique a internet).', 'err'); return; }
        const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '' });
        state.minimap = new L.Control.MiniMap(tiles, { position: 'bottomright', width: 170, height: 150, zoomLevelOffset: -5, toggleDisplay: true, aimingRectOptions: { color: '#e63946', weight: 2 } }).addTo(map);
        b.classList.add('active');
    }

    /* ---------- CAMADAS E DADOS RESTRITOS (SERVIDORES) ---------- */
    function genericStyle(def) {
        return { color: def.color || '#444', weight: def.weight || 1.5, dashArray: def.dashArray || null, fill: def.fill !== false, fillColor: def.fillColor || def.color || '#888', fillOpacity: def.fillOpacity != null ? def.fillOpacity : 0.4 };
    }

    function buildTechnicalCentroidsLayer() {
        const id = 'restrito_centroides_loteamentos';
        const def = {
            id,
            title: 'Centróides e Códigos Técnicos de Loteamentos',
            color: '#15803d',
            fillColor: '#22c55e'
        };
        const group = L.layerGroup();
        const lotGroup = layersMap['loteamento_por_bairro'];
        if (lotGroup && lotGroup.eachLayer) {
            lotGroup.eachLayer(l => {
                if (!l.getBounds || !l.feature) return;
                const center = l.getBounds().getCenter();
                const p = l.feature.properties || {};
                const u = toUTM22S(center.lat, center.lng);
                const area = calculateApproxArea(l.feature.geometry);
                const per = calcPerimeter(l.feature.geometry);
                const marker = L.circleMarker(center, {
                    radius: 5,
                    color: '#14532d',
                    fillColor: '#22c55e',
                    fillOpacity: 0.9,
                    weight: 2
                });
                marker.layerDef = def;
                marker.bindTooltip(`<b>[COD-${p.fid || 'S/N'}] ${esc(p.Loteamento || 'Loteamento')}</b><br>Bairro: ${esc(p.Bairro || '-')}<br>Área: ${fmtArea(area)} | Perím: ${fmtDist(per)}<br>UTM Centro: E ${u.x} N ${u.y}`, { direction: 'top' });
                marker.on('click', () => {
                    displayFeatureDetails(l.feature, l.layerDef || def, center);
                });
                group.addLayer(marker);
            });
        }
        layersMap[id] = group;
        state.restrictedIds.add(id);
        return def;
    }

    function buildRestrictedGroup(defs) {
        if (state.restrictedGroupEl) state.restrictedGroupEl.remove();
        const tab = $('tab-camadas');
        const group = document.createElement('div');
        group.className = 'layer-group restricted-group';
        group.innerHTML = `<div class="group-header" data-toggle="group-restrito"><span><i class="fa-solid fa-user-shield"></i> Camadas Internas <small class="badge-staff">SERVIDORES</small></span><i class="fa-solid fa-chevron-down toggle-icon"></i></div>
            <div class="group-content" id="group-restrito"></div>`;
        const content = group.querySelector('.group-content');
        defs.forEach(def => {
            const item = document.createElement('div');
            item.className = 'layer-item';
            item.innerHTML = `<label class="layer-label"><span class="layer-badge" style="background:${esc(def.fillColor || def.color || '#16a34a')};border:1px solid ${esc(def.color || '#14532d')};"></span><span><i class="fa-solid fa-lock lock-ico"></i> ${esc(def.title || def.id)}</span></label>
                <label class="switch"><input type="checkbox" id="layer-${esc(def.id)}"><span class="slider"></span></label>`;
            content.appendChild(item);
        });
        group.querySelector('.group-header').addEventListener('click', () => {
            const open = content.style.display !== 'none';
            content.style.display = open ? 'none' : 'block';
            group.querySelector('.toggle-icon').className = `fa-solid fa-chevron-${open ? 'right' : 'down'} toggle-icon`;
        });
        const firstGroup = tab.querySelector('.layer-group');
        if (firstGroup) firstGroup.parentNode.insertBefore(group, firstGroup);
        else tab.appendChild(group);
        state.restrictedGroupEl = group;
    }

    async function loadRestricted() {
        unloadRestricted();
        const allDefs = [];
        // 1. Camada técnica interna automática para servidores
        const techDef = buildTechnicalCentroidsLayer();
        allDefs.push(techDef);

        // 2. Camadas adicionais do bucket privado Supabase (se houver)
        try {
            const manifest = await GeoAuth.fetchJSON(GeoAuth.manifest);
            const bucketDefs = (manifest.layers || []).map(d => Object.assign({}, d, { id: 'restrito_' + d.id }));
            for (const def of bucketDefs) {
                try {
                    const data = await GeoAuth.fetchJSON(def.file);
                    const group = L.geoJSON(data, {
                        style: genericStyle(def),
                        onEachFeature: (feature, layer) => {
                            layer.layerDef = def;
                            layer.bindTooltip(`<i class="fa-solid fa-lock"></i> <b>${esc(featureName(feature.properties, def))}</b>`, { sticky: true });
                            setupFeatureInteractions(feature, layer, def);
                        }
                    });
                    layersMap[def.id] = group;
                    state.restrictedIds.add(def.id);
                    allDefs.push(def);
                } catch (e) { console.warn('Camada restrita ausente:', def.id); }
            }
        } catch (e) { /* bucket restrito ainda sem arquivos extras */ }

        buildRestrictedGroup(allDefs);
        allDefs.forEach(def => {
            const cb = $('layer-' + def.id);
            const g = layersMap[def.id];
            if (cb && g) {
                cb.addEventListener('change', () => {
                    cb.checked ? g.addTo(map) : map.removeLayer(g);
                    if (window.updateLayerCounters) window.updateLayerCounters();
                });
                if (def.visible_default) { cb.checked = true; g.addTo(map); }
            }
        });
        if (window.updateLayerCounters) window.updateLayerCounters();
    }

    function unloadRestricted() {
        state.restrictedIds.forEach(id => {
            const g = layersMap[id];
            if (g) { map.removeLayer(g); if (g.clearLayers) g.clearLayers(); }
            delete layersMap[id];
        });
        if (typeof activeHighlight !== 'undefined' && activeHighlight && activeHighlight.layerDef && state.restrictedIds.has(activeHighlight.layerDef.id)) activeHighlight = null;
        state.restrictedIds.clear();
        if (state.restrictedGroupEl) { state.restrictedGroupEl.remove(); state.restrictedGroupEl = null; }
        if (window.updateLayerCounters) window.updateLayerCounters();
        const d = $('info-details');
        if (d && state.lastDetail && state.lastDetail.restricted) {
            d.style.display = 'none';
            const ph = $('info-placeholder');
            if (ph) ph.style.display = 'block';
        }
        if (state.lastDetail && !state.lastDetail.restricted) {
            displayFeatureDetails(state.lastDetail.feature, state.lastDetail.layerDef, state.lastDetail.latlng);
        }
    }

    function onAuthChange(isStaff) {
        if (isStaff) {
            toast(`Modo Servidor ativado (${GeoAuth.email()}). Dados técnicos e camadas internas liberados.`, 'ok', 4500);
            setTimeout(loadRestricted, 400);
            if (state.lastDetail) {
                displayFeatureDetails(state.lastDetail.feature, state.lastDetail.layerDef, state.lastDetail.latlng);
            }
        } else {
            unloadRestricted();
            toast('Modo Acesso Público ativado (visualização de cidadão).', 'info', 3500);
        }
        const s = $('adv-q'); if (s && s.value) runSearch();
    }

    /* ---------- DETALHES: SOBREPOSIÇÕES NO PONTO + DADOS SERVIDOR + FICHA ---------- */
    function overlaysAt(latlng) {
        const out = [];
        eachFeatureLayer((l, id, restr) => {
            if (!l.getBounds || !l.getBounds().contains(latlng)) return;
            if (pointInGeom(latlng.lat, latlng.lng, l.feature.geometry)) out.push({ title: layerTitle(l, id), name: featureName(l.feature.properties, l.layerDef), restr });
        });
        return out;
    }

    function overlaysHTML(list) {
        if (!list.length) return '<p class="tp-hint">Nenhuma camada poligonal registrada neste ponto.</p>';
        return list.map(o => `<div class="info-row"><span class="info-label">${o.restr ? '<i class="fa-solid fa-lock"></i> ' : ''}${esc(o.title)}:</span><span class="info-value">${esc(o.name)}</span></div>`).join('');
    }

    function buildStaffTechBox(feature, layerDef) {
        if (!GeoAuth.isStaff()) {
            return `<div class="info-card staff-locked-card">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                    <span><i class="fa-solid fa-lock"></i> <b>Dados Técnicos Internos</b> (Exclusivo Servidores)</span>
                    <button type="button" class="tp-btn primary" id="btn-unlock-staff" style="width:auto;padding:5px 10px;">Entrar</button>
                </div>
            </div>`;
        }
        const props = feature.properties || {};
        const per = calcPerimeter(feature.geometry);
        let bboxHtml = '';
        try {
            const temp = L.geoJSON(feature);
            const b = temp.getBounds();
            const nw = toUTM22S(b.getNorth(), b.getWest());
            const se = toUTM22S(b.getSouth(), b.getEast());
            bboxHtml = `
                <div class="info-row"><span class="info-label">Envelope UTM (NO):</span><span class="info-value">E ${nw.x} | N ${nw.y}</span></div>
                <div class="info-row"><span class="info-label">Envelope UTM (SE):</span><span class="info-value">E ${se.x} | N ${se.y}</span></div>`;
        } catch (e) { /* ignore */ }

        return `<div class="info-card staff-tech-card">
            <b class="info-sec" style="color:#15803d;"><i class="fa-solid fa-user-shield"></i> Quadro Técnico Interno (Servidor)</b>
            <div class="info-row"><span class="info-label">Servidor Autenticado:</span><span class="info-value">${esc(GeoAuth.email())}</span></div>
            <div class="info-row"><span class="info-label">ID Interno / FID:</span><span class="info-value">${esc(props.fid ?? props.ID ?? props.id ?? 'N/D')}</span></div>
            <div class="info-row"><span class="info-label">Código da Camada:</span><span class="info-value">${esc(layerDef.id)}</span></div>
            <div class="info-row"><span class="info-label">Perímetro Calculado:</span><span class="info-value">${esc(fmtDist(per))}</span></div>
            ${bboxHtml}
        </div>`;
    }

    function afterDetails(feature, layerDef, latlng, container) {
        state.lastDetail = { feature, layerDef, latlng, restricted: state.restrictedIds.has(layerDef.id) };
        const ov = latlng ? overlaysAt(latlng) : [];
        const wrap = document.createElement('div');
        wrap.innerHTML = `
            ${buildStaffTechBox(feature, layerDef)}
            <div class="info-card">
                <b class="info-sec"><i class="fa-solid fa-layer-group"></i> Camadas Incidentes neste Ponto</b>
                ${latlng ? overlaysHTML(ov) : '<p class="tp-hint">Ponto de clique indisponível.</p>'}
            </div>
            <div class="detail-actions" style="flex-wrap: wrap;">
                <button type="button" class="tp-btn primary" id="btn-ficha"><i class="fa-solid fa-file-pdf"></i> Emitir Ficha (PDF)</button>
                ${latlng ? '<button type="button" class="tp-btn" id="btn-copy-coord"><i class="fa-regular fa-copy"></i> Copiar Coordenadas</button>' : ''}
                <button type="button" class="tp-btn" id="btn-extract-this" style="width: 100%; margin-top: 4px;"><i class="fa-solid fa-vector-square"></i> Extrair Vértices desta Feição</button>
            </div>`;
        container.appendChild(wrap);
        const btnUnlock = $('btn-unlock-staff');
        if (btnUnlock) btnUnlock.addEventListener('click', () => GeoAuth.openLogin('signin'));
        $('btn-ficha').addEventListener('click', () => openFicha(feature, layerDef, latlng, ov));
        const cc = $('btn-copy-coord');
        if (cc) cc.addEventListener('click', () => copyText(`${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`));
        const bExt = $('btn-extract-this');
        if (bExt) bExt.addEventListener('click', () => {
            const rows = featureVertexRows(feature, layerDef.title || layerDef.id);
            if (state.panel !== 'verts') togglePanel('verts');
            showExtraction(rows, 1);
            toast('Vértices da feição extraídos com sucesso!', 'ok', 2500);
        });
    }

    function openFicha(feature, layerDef, latlng, overlays) {
        const props = feature.properties || {};
        const staff = GeoAuth.isStaff();
        const area = calculateApproxArea(feature.geometry);
        const per = calcPerimeter(feature.geometry);
        const u = latlng ? toUTM22S(latlng.lat, latlng.lng) : null;
        const attrs = Object.entries(props).filter(([k, v]) => (staff || !SKIP_PROPS.has(k)) && v !== null && v !== '')
            .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(String(v).replace(/\s+/g, ' ').trim())}</td></tr>`).join('');
        const ov = (overlays || []).filter(o => staff || !o.restr)
            .map(o => `<tr><th>${o.restr ? '🔒 ' : ''}${esc(o.title)}</th><td>${esc(o.name)}</td></tr>`).join('');
        const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ficha - ${esc(featureName(props, layerDef))}</title>
            <style>
            body{font-family:'Segoe UI',Arial,sans-serif;color:#1e293b;margin:0;padding:24px 32px}
            .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #0d3b66;padding-bottom:10px;margin-bottom:16px}
            h1{margin:0;font-size:20px;color:#0d3b66}.org{font-size:12px;color:#64748b;text-align:right}
            h2{font-size:14px;color:#0d3b66;margin:18px 0 6px;border-left:4px solid #00a896;padding-left:8px}
            table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left;vertical-align:top}
            th{background:#f1f5f9;width:34%;font-weight:600}.int{background:#dcfce7;border:1px solid #16a34a;color:#14532d;padding:8px 12px;font-size:12px;margin-bottom:12px;border-radius:4px}
            .pub{background:#f1f5f9;border:1px solid #cbd5e1;color:#334155;padding:6px 10px;font-size:12px;margin-bottom:12px;border-radius:4px}
            .foot{margin-top:24px;font-size:11px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:8px}
            @media print{body{padding:0}}
            </style></head><body>
            <div class="head"><div><h1>Ficha de Consulta Territorial</h1><div style="font-size:13px">${esc(featureName(props, layerDef))}</div></div>
            <div style="display:flex;align-items:center;gap:12px;"><div class="org"><b>Prefeitura Municipal de Matinhos</b><br>Secretaria Municipal de Urbanismo e Planejamento Urbano<br>${new Date().toLocaleString('pt-BR')}</div><img src="img/logo-urbanismo.png" alt="Secretaria Municipal de Urbanismo e Planejamento Urbano" style="height:48px;width:auto;object-fit:contain;border-radius:6px;border:1px solid #cbd5e1;padding:2px;background:#fff;"></div></div>
            ${staff
                ? `<div class="int"><b>RELATÓRIO TÉCNICO INTERNO (SERVIDOR MUNICIPAL)</b> — Emitido por: ${esc(GeoAuth.email())}</div>`
                : `<div class="pub"><b>CONSULTA PÚBLICA</b> — Caráter meramente informativo ao cidadão.</div>`}
            <h2>Identificação Geométrica</h2><table><tr><th>Camada consultada</th><td>${esc(layerDef.title)}</td></tr>
            <tr><th>Área aproximada</th><td>${esc(fmtArea(area))}</td></tr>
            <tr><th>Perímetro aproximado</th><td>${esc(fmtDist(per))}</td></tr>
            ${u ? `<tr><th>Ponto consultado (Lat/Lon)</th><td>${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}</td></tr><tr><th>UTM 22S SIRGAS 2000</th><td>E ${u.x} &nbsp; N ${u.y}</td></tr>` : ''}</table>
            ${ov ? `<h2>Camadas incidentes no ponto</h2><table>${ov}</table>` : ''}
            ${attrs ? `<h2>Atributos Cadastrais</h2><table>${attrs}</table>` : ''}
            <div class="foot">Documento gerado pelo Geoportal Oficial de Matinhos (SIRGAS 2000). Consulte a Secretaria Municipal de Urbanismo e Planejamento Urbano para certidões oficiais.</div>
            <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`;
        const w = window.open('', '_blank');
        if (!w) { toast('O navegador bloqueou a nova janela. Permita pop-ups para gerar a ficha.', 'err', 6000); return; }
        w.document.open(); w.document.write(html); w.document.close();
    }

    /* ---------- auto-teste (?selftest=1) ---------- */
    function selfTest() {
        const results = [];
        const t = (name, fn) => { try { const r = fn(); results.push({ name, ok: r === true, info: r === true ? '' : String(r) }); } catch (e) { results.push({ name, ok: false, info: e.message }); } };
        t('utm ida e volta', () => { const u = toUTM22S(-25.8175, -48.536); const b = fromUTM22S(parseFloat(u.x), parseFloat(u.y)); const e = Math.hypot((b.lat + 25.8175) * 110574, (b.lng + 48.536) * 100000); return e < 0.05 || 'erro ' + e; });
        t('utm conhecido', () => { const b = fromUTM22S(752453.75, 7153896.31); return (Math.abs(b.lat + 25.711167) < 1e-4 && Math.abs(b.lng + 48.484051) < 1e-4) || JSON.stringify(b); });
        t('ponto em polígono com furo', () => { const g = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] }; return (pointInGeom(1, 1, g) && !pointInGeom(5, 5, g) && !pointInGeom(20, 20, g)) || 'falhou'; });
        t('normalização de acentos', () => norm('Balneário Çá') === 'balneario ca' || norm('Balneário Çá'));
        t('KML', () => { const k = toKML({ features: [{ properties: { nome: 'A&B' }, geometry: { type: 'Point', coordinates: [-48, -25] } }] }, 'x'); return (k.includes('<Placemark>') && k.includes('A&amp;B') && k.includes('-48,-25,0')) || k; });
        t('busca nos dados carregados', () => { const n = Object.keys(layersMap).length; if (!n) return 'sem camadas'; return searchFeatures('gaivotas', 'all', false).length > 0 || 'nenhum resultado para gaivotas'; });
        const pre = document.createElement('pre');
        pre.id = 'selftest';
        pre.textContent = JSON.stringify(results);
        pre.style.display = 'none';
        document.body.appendChild(pre);
        document.title = 'SELFTEST ' + (results.every(r => r.ok) ? 'OK' : 'FALHOU');
    }

    /* ---------- init ---------- */
    function init() {
        buildDock();
        try { if (localStorage.getItem('geoportal-dark') === '1') setDark(true); } catch (e) { /* ignore */ }
        document.addEventListener('fullscreenchange', () => {
            const b = $('dock-fullscreen');
            if (b) {
                const fs = !!document.fullscreenElement;
                b.classList.toggle('active', fs);
                b.innerHTML = `<i class="fa-solid ${fs ? 'fa-compress' : 'fa-expand'}"></i><span>${fs ? 'Sair Tela Cheia' : 'Tela Cheia'}</span>`;
            }
            setTimeout(() => map.invalidateSize(), 200);
        });
        const tabCamadasEl = $('tab-camadas');
        if (tabCamadasEl) {
            tabCamadasEl.addEventListener('change', () => {
                if (state.printPreview) refreshPrintFrameContent();
            });
        }
        document.addEventListener('keydown', e => {
            const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''));
            if (e.key === 'Escape') {
                if (state.drawMode) stopActiveDraw();
                else if (state.panel) closePanel();
            }
            if (e.key === 'Enter' && !typing && (state.drawMode === 'line' || state.drawMode === 'polygon')) {
                finishActiveDraw();
            }
            if (e.key === '/' && !typing) { e.preventDefault(); const s = $('search-input'); if (s) s.focus(); }
        });
        GeoAuth.onChange(onAuthChange);
        if (/[?&]selftest=1/.test(location.search)) setTimeout(selfTest, 4000);
        const qs = new URLSearchParams(location.search);
        if (qs.get('dark') === '1') setDark(true);
        if (qs.get('login') === '1') setTimeout(() => GeoAuth.openLogin(), 800);
        if (qs.get('panel') && PANELS[qs.get('panel')]) setTimeout(() => togglePanel(qs.get('panel')), 800);
    }

    return { init, afterDetails, toast, fromUTM22S, pointInGeom, searchFeatures, openPanel: name => { if (state.panel !== name) togglePanel(name); } };
})();
window.GeoTools = GeoTools;
