/**
 * Ferramentas adicionais do Geoportal de Matinhos
 * (busca avançada, coordenadas, desenho/exportação, layout de impressão, ficha,
 *  tela cheia, modo escuro, mini-mapa e camadas restritas para servidores).
 * Depende de: Leaflet, app.js (map, layersMap, setupFeatureInteractions...), styles.js (toUTM22S), auth.js.
 */
const GeoTools = (() => {
    const state = {
        panel: null,
        restrictedIds: new Set(),
        restrictedGroupEl: null,
        drawControl: null,
        drawnItems: null,
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
    function toast(msg, type = 'info', ms = 3400) {
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

    /* ---------- painéis flutuantes ---------- */
    const PANELS = {
        search: { icon: 'fa-magnifying-glass-location', title: 'Busca avançada', build: buildSearchPanel },
        coords: { icon: 'fa-location-crosshairs', title: 'Coordenadas', build: buildCoordsPanel },
        draw: { icon: 'fa-pen-ruler', title: 'Desenhar, medir e exportar', build: buildDrawPanel, onOpen: enableDrawing, onClose: disableDrawing },
        print: { icon: 'fa-print', title: 'Layout de impressão', build: buildPrintPanel }
    };

    function buildDock() {
        const wrap = document.querySelector('.main-wrapper');
        const dock = document.createElement('div');
        dock.className = 'tools-dock';
        const btn = (id, icon, title, fn) => {
            const b = document.createElement('button');
            b.type = 'button'; b.id = id; b.className = 'dock-btn'; b.title = title;
            b.innerHTML = `<i class="fa-solid ${icon}"></i>`;
            b.addEventListener('click', fn);
            dock.appendChild(b);
            return b;
        };
        Object.entries(PANELS).forEach(([k, p]) => btn('dock-' + k, p.icon, p.title, () => togglePanel(k)));
        dock.appendChild(Object.assign(document.createElement('div'), { className: 'dock-sep' }));
        btn('dock-fullscreen', 'fa-expand', 'Tela cheia', toggleFullscreen);
        btn('dock-dark', 'fa-moon', 'Modo escuro', toggleDark);
        btn('dock-minimap', 'fa-map', 'Mini-mapa de localização', toggleMinimap);
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
        $('dock-' + name).classList.add('active');
        state.panel = name;
        if (def.onOpen) def.onOpen();
    }

    function closePanel() {
        if (!state.panel) return;
        const name = state.panel;
        const el = $('panel-' + name);
        if (el) el.classList.remove('open');
        $('dock-' + name).classList.remove('active');
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
        const b = l.getBounds();
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
                    <option value="dd">Graus decimais (lat, lon)</option>
                    <option value="utm">UTM 22S SIRGAS 2000 (E, N)</option>
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
        btn.classList.add('active');
        btn.innerHTML = '<i class="fa-solid fa-hand-pointer"></i> Clique no mapa... (clique aqui p/ parar)';
    }
    function stopPick() {
        if (state.pickHandler) map.off('click', state.pickHandler);
        state.pickHandler = null;
        window.GEO_TOOL_BUSY = state.panel === 'draw';
        map.getContainer().classList.remove('pick-cursor');
        const btn = $('co-pick');
        if (btn) { btn.classList.remove('active'); btn.innerHTML = '<i class="fa-solid fa-crosshairs"></i> Ativar captura por clique'; }
    }

    /* ---------- DESENHO / MEDIÇÃO / EXPORTAÇÃO ---------- */
    function localizeDraw() {
        if (!window.L || !L.drawLocal) return;
        const d = L.drawLocal;
        d.draw.toolbar.buttons = { polyline: 'Desenhar linha', polygon: 'Desenhar polígono', rectangle: 'Desenhar retângulo', circle: 'Desenhar círculo', marker: 'Adicionar marcador' };
        d.draw.toolbar.actions = { title: 'Cancelar desenho', text: 'Cancelar' };
        d.draw.toolbar.finish = { title: 'Finalizar desenho', text: 'Finalizar' };
        d.draw.toolbar.undo = { title: 'Apagar último ponto', text: 'Apagar último ponto' };
        d.draw.handlers.polyline.tooltip = { start: 'Clique para começar a linha', cont: 'Clique para continuar', end: 'Clique no último ponto para finalizar' };
        d.draw.handlers.polygon.tooltip = { start: 'Clique para começar o polígono', cont: 'Clique para continuar', end: 'Clique no primeiro ponto para fechar' };
        d.draw.handlers.rectangle.tooltip = { start: 'Clique e arraste para desenhar' };
        d.draw.handlers.circle.tooltip = { start: 'Clique e arraste para desenhar o círculo' };
        d.draw.handlers.marker.tooltip = { start: 'Clique para posicionar o marcador' };
        d.edit.toolbar.actions = { save: { title: 'Salvar alterações', text: 'Salvar' }, cancel: { title: 'Cancelar edição', text: 'Cancelar' }, clearAll: { title: 'Apagar tudo', text: 'Apagar tudo' } };
        d.edit.toolbar.buttons = { edit: 'Editar desenhos', editDisabled: 'Nada para editar', remove: 'Apagar desenhos', removeDisabled: 'Nada para apagar' };
        d.edit.handlers.edit.tooltip = { text: 'Arraste os pontos para editar', subtext: 'Clique em Cancelar para desfazer' };
        d.edit.handlers.remove.tooltip = { text: 'Clique em um desenho para apagar' };
        if (L.GeometryUtil) {
            // corrige bug conhecido do Leaflet.draw 1.0.4 (variável "type" indefinida) e usa unidades métricas
            L.GeometryUtil.readableArea = a => a >= 1e6 ? (a / 1e6).toFixed(2) + ' km²' : a >= 1e4 ? (a / 1e4).toFixed(2) + ' ha' : a.toFixed(1) + ' m²';
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

    function ensureDrawn() {
        if (!state.drawnItems) {
            state.drawnItems = new L.FeatureGroup().addTo(map);
            map.on('draw:created', e => {
                const l = e.layer;
                const note = window.prompt('Anotação para este desenho (opcional):', '');
                if (note && note.trim()) {
                    l._note = note.trim();
                    l.bindTooltip(esc(l._note), { permanent: true, direction: 'top', className: 'draw-note' });
                }
                l.bindPopup(() => describeLayer(l));
                state.drawnItems.addLayer(l);
                if (l.openPopup && !(l instanceof L.Marker)) l.openPopup(l.getBounds ? l.getBounds().getCenter() : undefined);
                updateDrawCount();
            });
            map.on('draw:edited draw:deleted', updateDrawCount);
        }
    }

    function updateDrawCount() {
        const el = $('draw-count');
        if (el) el.textContent = state.drawnItems ? state.drawnItems.getLayers().length + ' desenho(s) no mapa' : '0 desenho(s) no mapa';
    }

    function enableDrawing() {
        if (!(L.Control && L.Control.Draw)) { toast('Biblioteca de desenho não carregada (verifique a internet).', 'err'); return; }
        localizeDraw();
        ensureDrawn();
        window.GEO_TOOL_BUSY = true;
        if (!state.drawControl) {
            state.drawControl = new L.Control.Draw({
                position: 'topright',
                draw: {
                    polyline: { shapeOptions: { color: '#e63946', weight: 3 } },
                    polygon: { allowIntersection: false, shapeOptions: { color: '#e63946', weight: 3, fillOpacity: 0.2 } },
                    rectangle: { shapeOptions: { color: '#e63946', weight: 3, fillOpacity: 0.2 } },
                    circle: { shapeOptions: { color: '#e63946', weight: 3, fillOpacity: 0.2 } },
                    marker: {},
                    circlemarker: false
                },
                edit: { featureGroup: state.drawnItems }
            });
        }
        map.addControl(state.drawControl);
    }
    function disableDrawing() {
        if (state.drawControl) map.removeControl(state.drawControl);
        window.GEO_TOOL_BUSY = !!state.pickHandler;
    }

    function drawnToGeoJSON() {
        const fc = { type: 'FeatureCollection', features: [] };
        if (!state.drawnItems) return fc;
        state.drawnItems.eachLayer(l => {
            const f = l.toGeoJSON();
            f.properties = Object.assign({}, f.properties, { nome: l._note || '' });
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
        const pm = fc.features.map((f, i) => `<Placemark><name>${xml(f.properties.nome || 'Desenho ' + (i + 1))}</name>${geomKML(f.geometry)}</Placemark>`).join('');
        return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(name)}</name>${pm}</Document></kml>`;
    }

    function exportPNG() {
        if (typeof html2canvas !== 'function') { toast('Biblioteca de captura não carregada.', 'err'); return; }
        toast('Gerando imagem...', 'info', 1800);
        html2canvas($('map'), { useCORS: true, logging: false, ignoreElements: el => el.classList && (el.classList.contains('leaflet-control-container')) })
            .then(c => c.toBlob(b => {
                const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'mapa_matinhos.png';
                document.body.appendChild(a); a.click(); a.remove();
                toast('PNG gerado. Se o fundo ficou em branco, troque o mapa base (OSM costuma funcionar) ou use Imprimir > Salvar PDF.', 'info', 7000);
            }))
            .catch(() => toast('Não foi possível gerar o PNG com este mapa base. Use o layout de impressão (Salvar como PDF).', 'err', 6000));
    }

    function buildDrawPanel(body) {
        body.innerHTML = `
            <p class="tp-hint">Use a barra de desenho no canto superior direito do mapa: linha, polígono, retângulo, círculo ou marcador. Clique em um desenho para ver comprimento, área e perímetro. Enquanto este painel estiver aberto, a consulta por clique nas camadas fica pausada.</p>
            <div id="draw-count" class="tp-hint">0 desenho(s) no mapa</div>
            <div class="tp-sub">Exportar desenhos</div>
            <div class="tp-row three">
                <button type="button" class="tp-btn" id="ex-geojson"><i class="fa-solid fa-file-code"></i> GeoJSON</button>
                <button type="button" class="tp-btn" id="ex-kml"><i class="fa-solid fa-earth-americas"></i> KML</button>
                <button type="button" class="tp-btn" id="ex-png"><i class="fa-solid fa-image"></i> PNG</button>
            </div>
            <div class="tp-row"><button type="button" class="tp-btn danger" id="ex-clear"><i class="fa-solid fa-trash-can"></i> Apagar todos os desenhos</button></div>`;
        const need = () => { const fc = drawnToGeoJSON(); if (!fc.features.length) { toast('Nenhum desenho para exportar.', 'err'); return null; } return fc; };
        $('ex-geojson').addEventListener('click', () => { const fc = need(); if (fc) download('desenhos_matinhos.geojson', JSON.stringify(fc, null, 2), 'application/geo+json'); });
        $('ex-kml').addEventListener('click', () => { const fc = need(); if (fc) download('desenhos_matinhos.kml', toKML(fc, 'Desenhos - Geoportal de Matinhos'), 'application/vnd.google-earth.kml+xml'); });
        $('ex-png').addEventListener('click', exportPNG);
        $('ex-clear').addEventListener('click', () => { if (state.drawnItems && state.drawnItems.getLayers().length && confirm('Apagar todos os desenhos?')) { state.drawnItems.clearLayers(); updateDrawCount(); } });
        updateDrawCount();
    }

    /* ---------- LAYOUT DE IMPRESSÃO ---------- */
    function buildPrintPanel(body) {
        body.innerHTML = `
            <div class="tp-row"><input type="text" id="pr-title" class="tp-input" value="Geoportal de Matinhos" placeholder="Título do mapa"></div>
            <div class="tp-row"><input type="text" id="pr-sub" class="tp-input" placeholder="Subtítulo / observação (opcional)"></div>
            <div class="tp-row two">
                <select id="pr-paper" class="tp-input"><option value="A4">A4</option><option value="A3">A3</option></select>
                <select id="pr-orient" class="tp-input"><option value="landscape">Paisagem</option><option value="portrait">Retrato</option></select>
            </div>
            <label class="tp-check"><input type="checkbox" id="pr-legend" checked> Incluir legenda das camadas ligadas</label>
            <div class="tp-row"><button type="button" class="tp-btn primary" id="pr-go"><i class="fa-solid fa-print"></i> Imprimir / Salvar como PDF</button></div>
            <p class="tp-hint">Na janela de impressão escolha "Salvar como PDF". O mapa sai com título, escala, legenda e data. Dica: ative "Gráficos de segundo plano" se as cores não aparecerem.</p>`;
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
        const who = GeoAuth.isStaff() ? ' · Uso interno' : '';
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
        if (b) { b.classList.toggle('active', on); b.innerHTML = `<i class="fa-solid ${on ? 'fa-sun' : 'fa-moon'}"></i>`; b.title = on ? 'Modo claro' : 'Modo escuro'; }
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

    /* ---------- camadas restritas (servidores) ---------- */
    function genericStyle(def) {
        return { color: def.color || '#444', weight: def.weight || 1.5, dashArray: def.dashArray || null, fill: def.fill !== false, fillColor: def.fillColor || def.color || '#888', fillOpacity: def.fillOpacity != null ? def.fillOpacity : 0.4 };
    }

    function buildRestrictedGroup(defs) {
        const tab = $('tab-camadas');
        const group = document.createElement('div');
        group.className = 'layer-group restricted-group';
        group.innerHTML = `<div class="group-header" data-toggle="group-restrito"><span><i class="fa-solid fa-user-shield"></i> Camadas Restritas <small class="badge-staff">SERVIDORES</small></span><i class="fa-solid fa-chevron-down toggle-icon"></i></div>
            <div class="group-content" id="group-restrito"></div>`;
        const content = group.querySelector('.group-content');
        defs.forEach(def => {
            const item = document.createElement('div');
            item.className = 'layer-item';
            item.innerHTML = `<label class="layer-label"><span class="layer-badge" style="background:${esc(def.fillColor || def.color || '#888')};border:1px solid ${esc(def.color || '#444')};"></span><span><i class="fa-solid fa-lock lock-ico"></i> ${esc(def.title || def.id)}</span></label>
                <label class="switch"><input type="checkbox" id="layer-${esc(def.id)}"><span class="slider"></span></label>`;
            content.appendChild(item);
        });
        group.querySelector('.group-header').addEventListener('click', () => {
            const open = content.style.display !== 'none';
            content.style.display = open ? 'none' : 'block';
            group.querySelector('.toggle-icon').className = `fa-solid fa-chevron-${open ? 'right' : 'down'} toggle-icon`;
        });
        const groups = tab.querySelectorAll('.layer-group');
        const anchor = groups[groups.length - 1];
        anchor.parentNode.insertBefore(group, anchor.nextSibling);
        state.restrictedGroupEl = group;
    }

    async function loadRestricted() {
        let manifest;
        try { manifest = await GeoAuth.fetchJSON(GeoAuth.manifest); }
        catch (e) { toast('Login realizado. Nenhuma camada restrita publicada ainda.', 'info', 5000); return; }
        const defs = (manifest.layers || []).map(d => Object.assign({}, d, { id: 'restrito_' + d.id }));
        if (!defs.length) { toast('Login realizado. A lista de camadas restritas está vazia.', 'info'); return; }
        buildRestrictedGroup(defs);
        let ok = 0;
        for (const def of defs) {
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
                const cb = $('layer-' + def.id);
                cb.addEventListener('change', () => cb.checked ? group.addTo(map) : map.removeLayer(group));
                if (def.visible_default) { cb.checked = true; group.addTo(map); }
                ok++;
            } catch (e) { console.error('Camada restrita falhou:', def.id, e); toast('Falha ao carregar camada restrita: ' + (def.title || def.id), 'err'); }
        }
        toast(`Acesso de servidor: ${ok} camada(s) restrita(s) disponível(is).`, 'ok', 4500);
    }

    function unloadRestricted() {
        state.restrictedIds.forEach(id => {
            const g = layersMap[id];
            if (g) { map.removeLayer(g); g.clearLayers(); }
            delete layersMap[id];
        });
        if (typeof activeHighlight !== 'undefined' && activeHighlight && activeHighlight.layerDef && state.restrictedIds.has(activeHighlight.layerDef.id)) activeHighlight = null;
        state.restrictedIds.clear();
        if (state.restrictedGroupEl) { state.restrictedGroupEl.remove(); state.restrictedGroupEl = null; }
        const d = $('info-details');
        if (d && state.lastDetail && state.lastDetail.restricted) { d.style.display = 'none'; const ph = $('info-placeholder'); if (ph) ph.style.display = 'block'; }
        state.lastDetail = null;
    }

    function onAuthChange(isStaff) {
        if (isStaff) { toast('Sessão de servidor iniciada.', 'ok'); loadRestricted(); }
        else { unloadRestricted(); toast('Sessão encerrada. Você voltou ao acesso público.', 'info'); }
        const s = $('adv-q'); if (s && s.value) runSearch();
    }

    /* ---------- detalhes: sobreposições no ponto + ficha ---------- */
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

    function afterDetails(feature, layerDef, latlng, container) {
        state.lastDetail = { feature, layerDef, latlng, restricted: state.restrictedIds.has(layerDef.id) };
        const staffNote = GeoAuth.isStaff() ? '' : `<p class="tp-hint"><i class="fa-solid fa-lock"></i> Servidores municipais veem camadas adicionais nesta lista após o login.</p>`;
        const ov = latlng ? overlaysAt(latlng) : [];
        const wrap = document.createElement('div');
        wrap.innerHTML = `<div class="info-card">
                <b class="info-sec"><i class="fa-solid fa-layer-group"></i> Camadas neste ponto</b>
                ${latlng ? overlaysHTML(ov) : '<p class="tp-hint">Ponto de clique indisponível.</p>'}${staffNote}
            </div>
            <div class="detail-actions">
                <button type="button" class="tp-btn primary" id="btn-ficha"><i class="fa-solid fa-file-pdf"></i> Gerar ficha (PDF)</button>
                ${latlng ? '<button type="button" class="tp-btn" id="btn-copy-coord"><i class="fa-regular fa-copy"></i> Copiar coordenadas</button>' : ''}
            </div>`;
        container.appendChild(wrap);
        $('btn-ficha').addEventListener('click', () => openFicha(feature, layerDef, latlng, ov));
        const cc = $('btn-copy-coord');
        if (cc) cc.addEventListener('click', () => copyText(`${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`));
    }

    function openFicha(feature, layerDef, latlng, overlays) {
        const props = feature.properties || {};
        const staff = GeoAuth.isStaff();
        const area = calculateApproxArea(feature.geometry);
        const u = latlng ? toUTM22S(latlng.lat, latlng.lng) : null;
        const attrs = Object.entries(props).filter(([k, v]) => !SKIP_PROPS.has(k) && v !== null && v !== '')
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
            th{background:#f1f5f9;width:34%;font-weight:600}.int{background:#fef3c7;border:1px solid #f59e0b;color:#92400e;padding:6px 10px;font-size:12px;margin-bottom:12px;border-radius:4px}
            .foot{margin-top:24px;font-size:11px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:8px}
            @media print{body{padding:0}}
            </style></head><body>
            <div class="head"><div><h1>Ficha de Consulta Territorial</h1><div style="font-size:13px">${esc(featureName(props, layerDef))}</div></div>
            <div class="org">Prefeitura Municipal de Matinhos<br>Secretaria Municipal de Urbanismo<br>${new Date().toLocaleString('pt-BR')}</div></div>
            ${staff ? '<div class="int"><b>USO INTERNO</b> — contém informações de camadas restritas. Não divulgar.</div>' : ''}
            <h2>Identificação</h2><table><tr><th>Camada consultada</th><td>${esc(layerDef.title)}</td></tr>
            <tr><th>Área aproximada</th><td>${esc(fmtArea(area))}</td></tr>
            ${u ? `<tr><th>Ponto consultado (Lat/Lon)</th><td>${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}</td></tr><tr><th>UTM 22S SIRGAS 2000</th><td>E ${u.x} &nbsp; N ${u.y}</td></tr>` : ''}</table>
            ${ov ? `<h2>Camadas incidentes no ponto</h2><table>${ov}</table>` : ''}
            ${attrs ? `<h2>Atributos</h2><table>${attrs}</table>` : ''}
            <div class="foot">Documento informativo gerado pelo Geoportal de Matinhos, sem valor legal. Áreas calculadas de forma aproximada sobre a base cartográfica municipal (SIRGAS 2000). Consulte a Secretaria de Urbanismo para certidões oficiais.</div>
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
        t('utm conhecido (E 752453 N 7153896 -> lat -25.711 lon -48.484)', () => { const b = fromUTM22S(752453.75, 7153896.31); return (Math.abs(b.lat + 25.711167) < 1e-4 && Math.abs(b.lng + 48.484051) < 1e-4) || JSON.stringify(b); });
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
            if (b) { b.classList.toggle('active', !!document.fullscreenElement); b.innerHTML = `<i class="fa-solid ${document.fullscreenElement ? 'fa-compress' : 'fa-expand'}"></i>`; }
            setTimeout(() => map.invalidateSize(), 200);
        });
        window.addEventListener('afterprint', endPrint);
        document.addEventListener('keydown', e => {
            const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''));
            if (e.key === 'Escape' && state.panel) closePanel();
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
