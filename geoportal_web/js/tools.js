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
        drawSeq: 1,
        drawMode: null, // 'line' | 'polygon' | 'rect' | 'circle' | 'marker' | 'text' | null
        drawPts: [],
        drawVerts: null,
        drawPreview: null,
        drawColor: '#e63946',
        minimap: null,
        pickHandler: null,
        coordMarker: null,
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

    /** Inverso de toUTM22S (Newton sobre a função direta, convergência em milímetros). */
    function fromUTM22S(easting, northing) {
        let lat = (northing - 10000000) / 110574;
        let lon = -51 + (easting - 500000) / (111320 * Math.cos(lat * Math.PI / 180));
        for (let i = 0; i < 8; i++) {
            const u = toUTM22S(lat, lon);
            const dx = easting - parseFloat(u.x);
            const dy = northing - parseFloat(u.y);
            lat += dy / 110574;
            lon += dx / (111320 * Math.cos(lat * Math.PI / 180));
            if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) break;
        }
        return { lat, lng: lon };
    }

    const fmtDist = m => m >= 1000 ? (m / 1000).toFixed(3) + ' km' : m.toFixed(2) + ' m';
    const fmtArea = a => a >= 10000 ? `${(a / 10000).toFixed(4)} ha (${a.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m²)` : `${a.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m²`;

    function calcPerimeter( geometry ) {
        if (!geometry || !geometry.coordinates) return 0;
        const ring = geometry.type === 'MultiPolygon'
            ? geometry.coordinates[0][0]
            : (geometry.type === 'Polygon' ? geometry.coordinates[0] : []);
        if (ring.length < 2) return 0;
        let p = 0;
        for (let i = 0; i < ring.length - 1; i++) {
            p += L.latLng(ring[i][1], ring[i][0]).distanceTo(L.latLng(ring[i + 1][1], ring[i + 1][0]));
        }
        return p;
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
        coords: { icon: 'fa-location-crosshairs', label: 'Buscar Coordenadas', title: 'Buscar e Capturar Coordenadas', build: buildCoordsPanel, onClose: stopPick },
        draw:   { icon: 'fa-pen-ruler', label: 'Desenhar no Mapa', title: 'Desenhar, Anotar e Exportar', build: buildDrawPanel, onOpen: onDrawPanelOpen, onClose: stopActiveDraw },
        print:  { icon: 'fa-print', label: 'Imprimir Mapa', title: 'Layout de Impressão / PDF', build: buildPrintPanel }
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

    /* ---------- COORDENADAS ---------- */
    function buildCoordsPanel(body) {
        body.innerHTML = `
            <div class="tp-sub">Ir para uma coordenada</div>
            <div class="tp-row">
                <select id="co-mode" class="tp-input">
                    <option value="dd">Graus decimais (Lat, Lon)</option>
                    <option value="utm">UTM 22S SIRGAS 2000 (Este E, Norte N)</option>
                </select>
            </div>
            <div class="tp-row two">
                <input type="text" id="co-a" class="tp-input" placeholder="Latitude  ex.: -25,8175">
                <input type="text" id="co-b" class="tp-input" placeholder="Longitude  ex.: -48,536">
            </div>
            <div class="tp-row"><button type="button" class="tp-btn primary" id="co-go"><i class="fa-solid fa-location-arrow"></i> Ir para o ponto</button></div>
            <div class="tp-sub">Capturar coordenada no mapa</div>
            <div class="tp-row"><button type="button" class="tp-btn" id="co-pick"><i class="fa-solid fa-crosshairs"></i> Ativar captura por clique</button></div>
            <div id="co-out" class="co-out">Nenhum ponto selecionado.</div>`;
        const mode = $('co-mode');
        mode.addEventListener('change', () => {
            const utm = mode.value === 'utm';
            $('co-a').placeholder = utm ? 'Este (E)  ex.: 752453,75' : 'Latitude  ex.: -25,8175';
            $('co-b').placeholder = utm ? 'Norte (N)  ex.: 7153896,31' : 'Longitude  ex.: -48,536';
        });
        $('co-go').addEventListener('click', goToCoord);
        ['co-a', 'co-b'].forEach(i => $(i).addEventListener('keydown', e => { if (e.key === 'Enter') goToCoord(); }));
        $('co-pick').addEventListener('click', togglePick);
    }

    const num = s => parseFloat(String(s).trim().replace(/\s/g, '').replace(',', '.'));

    function showCoordInfo(latlng, flyTo) {
        const u = toUTM22S(latlng.lat, latlng.lng);
        const dd = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
        const utm = `E ${u.x} N ${u.y}`;
        if (state.coordMarker) state.coordMarker.remove();
        state.coordMarker = L.marker(latlng).addTo(map).bindPopup(`<b>Ponto</b><br>Lat/Lon: ${dd}<br>UTM 22S: ${utm}`).openPopup();
        if (flyTo) map.flyTo(latlng, Math.max(map.getZoom(), 17), { duration: 1 });
        const out = $('co-out');
        if (out) {
            out.innerHTML = `<div><b>Lat/Lon:</b> ${dd} <button type="button" class="mini-copy" data-c="${dd}" title="Copiar"><i class="fa-regular fa-copy"></i></button></div>
                <div><b>UTM 22S:</b> ${utm} <button type="button" class="mini-copy" data-c="${u.x}, ${u.y}" title="Copiar"><i class="fa-regular fa-copy"></i></button></div>`;
            out.querySelectorAll('.mini-copy').forEach(b => b.addEventListener('click', () => copyText(b.dataset.c)));
        }
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

    function togglePick() {
        const btn = $('co-pick');
        if (state.pickHandler) { stopPick(); return; }
        window.GEO_TOOL_BUSY = true;
        state.pickHandler = e => showCoordInfo(e.latlng, false);
        map.on('click', state.pickHandler);
        map.getContainer().classList.add('pick-cursor');
        if (btn) {
            btn.classList.add('active');
            btn.innerHTML = '<i class="fa-solid fa-hand-pointer"></i> Clique no mapa... (clique p/ parar)';
        }
    }
    function stopPick() {
        if (state.pickHandler) map.off('click', state.pickHandler);
        state.pickHandler = null;
        window.GEO_TOOL_BUSY = !!state.drawMode;
        map.getContainer().classList.remove('pick-cursor');
        const btn = $('co-pick');
        if (btn) { btn.classList.remove('active'); btn.innerHTML = '<i class="fa-solid fa-crosshairs"></i> Ativar captura por clique'; }
    }

    /* ---------- MOTOR DE DESENHO, ANOTAÇÃO E EXPORTAÇÃO ---------- */
    function ensureDrawnGroup() {
        if (!state.drawnItems) {
            state.drawnItems = new L.FeatureGroup().addTo(map);
        }
        if (!state.drawVerts) {
            state.drawVerts = new L.LayerGroup().addTo(map);
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

            <div id="draw-live-box" class="draw-live-box" style="display:none;">
                <div id="draw-live-hint" class="draw-live-hint">Clique no mapa para iniciar...</div>
                <div id="draw-live-metric" class="draw-live-metric"></div>
                <div class="tp-row three" style="margin-top:6px;margin-bottom:0;">
                    <button type="button" class="tp-btn primary" id="draw-btn-finish"><i class="fa-solid fa-check"></i> Concluir</button>
                    <button type="button" class="tp-btn" id="draw-btn-undo"><i class="fa-solid fa-rotate-left"></i> Desfazer</button>
                    <button type="button" class="tp-btn danger" id="draw-btn-cancel"><i class="fa-solid fa-xmark"></i> Cancelar</button>
                </div>
            </div>

            <div class="tp-sub">Desenhos no Mapa (<span id="draw-count">0</span>)</div>
            <div id="draw-items-list" class="draw-items-list">
                <div class="tp-hint">Nenhum desenho adicionado ainda. Selecione uma ferramenta acima e clique no mapa.</div>
            </div>

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

        $('draw-btn-finish').addEventListener('click', finishActiveDraw);
        $('draw-btn-undo').addEventListener('click', undoDrawPoint);
        $('draw-btn-cancel').addEventListener('click', stopActiveDraw);

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
        if (box) box.style.display = 'block';
        if (metric) metric.textContent = '';

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

        map.on('click', onDrawMapClick);
        map.on('mousemove', onDrawMapMove);
        map.on('dblclick', onDrawMapDblClick);
    }

    function stopActiveDraw() {
        map.off('click', onDrawMapClick);
        map.off('mousemove', onDrawMapMove);
        map.off('dblclick', onDrawMapDblClick);
        if (state.drawPreview) { state.drawPreview.remove(); state.drawPreview = null; }
        if (state.drawVerts) state.drawVerts.clearLayers();
        state.drawMode = null;
        state.drawPts = [];
        window.GEO_TOOL_BUSY = !!state.pickHandler;
        map.getContainer().classList.remove('pick-cursor');
        setTimeout(() => { if (map && map.doubleClickZoom) map.doubleClickZoom.enable(); }, 150);

        document.querySelectorAll('.draw-tool-btn').forEach(b => b.classList.remove('active'));
        const box = $('draw-live-box');
        if (box) box.style.display = 'none';
    }

    function undoDrawPoint() {
        if (!state.drawPts.length) return;
        state.drawPts.pop();
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
        if (labelInput && !layer._isText) labelInput.value = '';
        renderDrawnList();
        toast(`${defaultTypeLabel} adicionado ao mapa!`, 'ok', 2200);
    }

    function onDrawMapClick(e) {
        if (!state.drawMode) return;
        const ll = e.latlng;
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
        // Se clicou muito próximo do último ponto (ex: segundo clique de um duplo clique), ignora duplicata
        if (state.drawPts.length > 0) {
            const last = state.drawPts[state.drawPts.length - 1];
            if (map.latLngToContainerPoint(last).distanceTo(map.latLngToContainerPoint(ll)) < 6) {
                return;
            }
        }
        state.drawPts.push(ll);
        redrawVertices();
        updateLivePreview(null);
    }

    function onDrawMapMove(e) {
        if (!state.drawMode || !state.drawPts.length) return;
        updateLivePreview(e.latlng);
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

    /* ---------- LAYOUT DE IMPRESSÃO ---------- */
    function buildPrintPanel(body) {
        body.innerHTML = `
            <div class="tp-row"><input type="text" id="pr-title" class="tp-input" value="Geoportal de Matinhos" placeholder="Título do mapa"></div>
            <div class="tp-row"><input type="text" id="pr-sub" class="tp-input" placeholder="Subtítulo / observação (opcional)"></div>
            <div class="tp-row two">
                <select id="pr-paper" class="tp-input"><option value="A4">Folha A4</option><option value="A3">Folha A3</option></select>
                <select id="pr-orient" class="tp-input"><option value="landscape">Paisagem</option><option value="portrait">Retrato</option></select>
            </div>
            <label class="tp-check"><input type="checkbox" id="pr-legend" checked> Incluir legenda das camadas visíveis</label>
            <div class="tp-row"><button type="button" class="tp-btn primary" id="pr-go"><i class="fa-solid fa-print"></i> Imprimir / Salvar como PDF</button></div>
            <p class="tp-hint">Na janela de impressão escolha "Salvar como PDF". O mapa sai com cabeçalho da Prefeitura, escala, legenda e data.</p>`;
        $('pr-go').addEventListener('click', doPrint);
    }

    function legendEntries() {
        const items = [];
        Object.entries(layersMap).forEach(([id, g]) => {
            if (!g || !map.hasLayer(g)) return;
            let def = null;
            g.eachLayer(l => { if (!def && l.layerDef) def = l.layerDef; });
            if (id === 'zoneamento_corrigido') {
                Object.values(ZONE_CONFIG).forEach(z => items.push({ color: z.color, label: z.label }));
            } else if (id === 'loteamento_por_bairro') {
                items.push({ color: 'linear-gradient(45deg,#d7191c,#fdae61,#abdda4,#2b83ba)', label: (def && def.title) || 'Loteamentos por Bairro' });
            } else if (def) {
                items.push({ color: def.fillColor || def.color || '#888', label: def.title, border: def.color });
            }
        });
        return items;
    }

    function doPrint() {
        const title = $('pr-title').value.trim() || 'Geoportal de Matinhos';
        const sub = $('pr-sub').value.trim();
        const paper = $('pr-paper').value, orient = $('pr-orient').value;
        let st = $('print-page-style');
        if (!st) { st = document.createElement('style'); st.id = 'print-page-style'; document.head.appendChild(st); }
        st.textContent = `@page { size: ${paper} ${orient}; margin: 8mm; }`;
        let fr = $('print-frame');
        if (fr) fr.remove();
        fr = document.createElement('div');
        fr.id = 'print-frame';
        const legend = $('pr-legend').checked
            ? `<div class="pf-legend"><b>Legenda</b>${legendEntries().map(i => `<div><span style="background:${i.color};${i.border ? 'border:1px solid ' + i.border : ''}"></span>${esc(i.label)}</div>`).join('')}</div>` : '';
        const who = GeoAuth.isStaff() ? ` · Servidor: ${esc(GeoAuth.email())} (Uso Interno)` : ' · Consulta Pública';
        fr.innerHTML = `<div class="pf-head"><div><div class="pf-title">${esc(title)}</div>${sub ? `<div class="pf-sub">${esc(sub)}</div>` : ''}</div>
            <div class="pf-meta">Prefeitura Municipal de Matinhos<br>Secretaria Municipal de Urbanismo<br>${new Date().toLocaleDateString('pt-BR')}${who}</div></div>
            ${legend}<div class="pf-foot">SIRGAS 2000 · Geoportal de Matinhos · Documento informativo, sem valor legal.</div>`;
        document.body.appendChild(fr);
        document.body.classList.add('print-layout');
        closePanel();
        map.invalidateSize();
        setTimeout(() => window.print(), 400);
    }

    function endPrint() {
        document.body.classList.remove('print-layout');
        const fr = $('print-frame'); if (fr) fr.remove();
        if (window.map) map.invalidateSize();
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
                cb.addEventListener('change', () => cb.checked ? g.addTo(map) : map.removeLayer(g));
                if (def.visible_default) { cb.checked = true; g.addTo(map); }
            }
        });
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
            <div class="detail-actions">
                <button type="button" class="tp-btn primary" id="btn-ficha"><i class="fa-solid fa-file-pdf"></i> Emitir Ficha (PDF)</button>
                ${latlng ? '<button type="button" class="tp-btn" id="btn-copy-coord"><i class="fa-regular fa-copy"></i> Copiar Coordenadas</button>' : ''}
            </div>`;
        container.appendChild(wrap);
        const btnUnlock = $('btn-unlock-staff');
        if (btnUnlock) btnUnlock.addEventListener('click', () => GeoAuth.openLogin('signin'));
        $('btn-ficha').addEventListener('click', () => openFicha(feature, layerDef, latlng, ov));
        const cc = $('btn-copy-coord');
        if (cc) cc.addEventListener('click', () => copyText(`${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`));
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
            <div class="org">Prefeitura Municipal de Matinhos<br>Secretaria Municipal de Urbanismo<br>${new Date().toLocaleString('pt-BR')}</div></div>
            ${staff
                ? `<div class="int"><b>RELATÓRIO TÉCNICO INTERNO (SERVIDOR MUNICIPAL)</b> — Emitido por: ${esc(GeoAuth.email())}</div>`
                : `<div class="pub"><b>CONSULTA PÚBLICA</b> — Caráter meramente informativo ao cidadão.</div>`}
            <h2>Identificação Geométrica</h2><table><tr><th>Camada consultada</th><td>${esc(layerDef.title)}</td></tr>
            <tr><th>Área aproximada</th><td>${esc(fmtArea(area))}</td></tr>
            <tr><th>Perímetro aproximado</th><td>${esc(fmtDist(per))}</td></tr>
            ${u ? `<tr><th>Ponto consultado (Lat/Lon)</th><td>${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}</td></tr><tr><th>UTM 22S SIRGAS 2000</th><td>E ${u.x} &nbsp; N ${u.y}</td></tr>` : ''}</table>
            ${ov ? `<h2>Camadas incidentes no ponto</h2><table>${ov}</table>` : ''}
            ${attrs ? `<h2>Atributos Cadastrais</h2><table>${attrs}</table>` : ''}
            <div class="foot">Documento gerado pelo Geoportal Oficial de Matinhos (SIRGAS 2000). Consulte a Secretaria Municipal de Urbanismo para certidões oficiais.</div>
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
        window.addEventListener('afterprint', endPrint);
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
