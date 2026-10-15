/**
 * Geoportal Matinhos - Configuração de Estilos e Metadados
 * Secretaria Municipal de Urbanismo - Prefeitura de Matinhos
 */

const ZONE_CONFIG = {
    "ZC - Zona Central": {
        color: "#72075e",
        label: "ZC - Zona Central",
        desc: "Núcleo comercial e de serviços centrais do município com uso misto e maior dinamismo urbano.",
        badge: "ZC",
        opacity: 0.65
    },
    "ZR1 - Zona Residencial 1": {
        color: "#ff7d00",
        label: "ZR1 - Zona Residencial 1",
        desc: "Zona residencial de baixa densidade, predominância de habitações unifamiliares e baixo impacto.",
        badge: "ZR1",
        opacity: 0.65
    },
    "ZR2 - Zona Residencial 2": {
        color: "#f6bd60",
        label: "ZR2 - Zona Residencial 2",
        desc: "Zona residencial de média densidade com permissão para comércio vicinal e pequenos serviços.",
        badge: "ZR2",
        opacity: 0.65
    },
    "ZR3 - Zona Residencial 3": {
        color: "#e07a5f",
        label: "ZR3 - Zona Residencial 3",
        desc: "Zona residencial consolidada de média a alta densidade, permitindo multifamiliar e uso misto.",
        badge: "ZR3",
        opacity: 0.65
    },
    "ZUC1 - Zona de Uso Comercial 1": {
        color: "#ef26b7",
        label: "ZUC1 - Zona de Uso Comercial 1",
        desc: "Corredores e eixos viários comerciais de grande fluxo com concentração de comércio e serviços.",
        badge: "ZUC1",
        opacity: 0.65
    },
    "ZUC2 - Zona de Uso Comercial 2": {
        color: "#b52cbf",
        label: "ZUC2 - Zona de Uso Comercial 2",
        desc: "Zona comercial e de serviços complementares integrados aos bairros.",
        badge: "ZUC2",
        opacity: 0.65
    },
    "ZB1 - Zona Balneária 1": {
        color: "#9f86c0",
        label: "ZB1 - Zona Balneária 1",
        desc: "Faixa de orla balneária com vocação turística, hotelaria, gastronomia e residência temporária.",
        badge: "ZB1",
        opacity: 0.65
    },
    "ZB2 - Zona Balneária 2": {
        color: "#c77dff",
        label: "ZB2 - Zona Balneária 2",
        desc: "Área balneária intermediária de habitação e turismo de temporada.",
        badge: "ZB2",
        opacity: 0.65
    },
    "ZB3 - Zona Balneária 3": {
        color: "#9d4edd",
        label: "ZB3 - Zona Balneária 3",
        desc: "Zona balneária complementar e de transição urbana para os balneários ao norte.",
        badge: "ZB3",
        opacity: 0.65
    },
    "MPU - Macrozona Periurbana": {
        color: "#ff4500",
        label: "MPU - Macrozona Periurbana",
        desc: "Área de transição periurbana entre o perímetro urbano consolidado e a zona rural/ambiental.",
        badge: "MPU",
        opacity: 0.55
    },
    "ZDR1 - Zona de Densidade Restrita 1": {
        color: "#f4d306",
        label: "ZDR1 - Densidade Restrita 1",
        desc: "Zona com restrições construtivas e de densidade em razão de declividade ou drenagem.",
        badge: "ZDR1",
        opacity: 0.65
    },
    "ZDR2 - Zona de Densidade Restrita 2": {
        color: "#437600",
        label: "ZDR2 - Densidade Restrita 2",
        desc: "Zona de densidade restrita com proteção à cobertura vegetal remanescente.",
        badge: "ZDR2",
        opacity: 0.65
    },
    "ZEI - Zona Especial Industrial": {
        color: "#8a817c",
        label: "ZEI - Zona Especial Industrial",
        desc: "Zona vocacionada a empreendimentos industriais, centros de distribuição e galpões logísticos.",
        badge: "ZEI",
        opacity: 0.65
    },
    "ZEIS1 - Zona Especial de Interesse Social 1": {
        color: "#dad2bc",
        label: "ZEIS 1 - Interesse Social 1",
        desc: "Áreas de assentamentos consolidados destinadas à regularização fundiária e melhorias urbanas.",
        badge: "ZEIS 1",
        opacity: 0.70
    },
    "ZEIS 2 - Zona Especial de Interesse Social 2": {
        color: "#d81159",
        label: "ZEIS 2 - Interesse Social 2",
        desc: "Glebas não edificadas ou subutilizadas destinadas à implantação de Habitação de Interesse Social (HIS).",
        badge: "ZEIS 2",
        opacity: 0.70
    },
    "ZEP - Zona Especial Pesqueira": {
        color: "#070469",
        label: "ZEP - Zona Especial Pesqueira",
        desc: "Zona de apoio às comunidades tradicionais pesqueiras e equipamentos náuticos artesanais.",
        badge: "ZEP",
        opacity: 0.65
    },
    "ZRA - Zona de Restrição Ambiental": {
        color: "#90a955",
        label: "ZRA - Restrição Ambiental",
        desc: "Zona de transição com ecossistemas costeiros frágeis, restingas e manguezais protegidos.",
        badge: "ZRA",
        opacity: 0.65
    },
    "ZRM - Zona de Restrição Máxima": {
        color: "#ae2012",
        label: "ZRM - Restrição Máxima",
        desc: "Zona de preservação integral e proteção ecológica estrita. Proibida ocupação urbana.",
        badge: "ZRM",
        opacity: 0.75
    }
};

/**
 * Converte coordenadas WGS84 (Lat, Lng) para UTM SIRGAS 2000 Fuso 22 Sul
 */
function toUTM22S(lat, lon) {
    const a = 6378137.0; // WGS84/GRS80 semi-major axis
    const f = 1 / 298.257223563; // flattening
    const k0 = 0.9996; // scale factor
    const e = Math.sqrt(2 * f - f * f);
    const ePrime2 = (e * e) / (1 - e * e);

    const lon0 = -51.0; // Central meridian for UTM Zone 22 (-51°)
    const phi = lat * Math.PI / 180;
    const lambda = lon * Math.PI / 180;
    const lambda0 = lon0 * Math.PI / 180;

    const N = a / Math.sqrt(1 - e * e * Math.sin(phi) * Math.sin(phi));
    const T = Math.tan(phi) * Math.tan(phi);
    const C = ePrime2 * Math.cos(phi) * Math.cos(phi);
    const A = Math.cos(phi) * (lambda - lambda0);

    const M = a * ((1 - e * e / 4 - 3 * e * e * e * e / 64 - 5 * Math.pow(e, 6) / 256) * phi
        - (3 * e * e / 8 + 3 * e * e * e * e / 32 + 45 * Math.pow(e, 6) / 1024) * Math.sin(2 * phi)
        + (15 * e * e * e * e / 256 + 45 * Math.pow(e, 6) / 1024) * Math.sin(4 * phi)
        - (35 * Math.pow(e, 6) / 3072) * Math.sin(6 * phi));

    let easting = k0 * N * (A + (1 - T + C) * Math.pow(A, 3) / 6
        + (5 - 18 * T + T * T + 72 * C - 58 * ePrime2) * Math.pow(A, 5) / 120) + 500000.0;

    let northing = k0 * (M + N * Math.tan(phi) * (A * A / 2
        + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24
        + (61 - 58 * T + T * T + 600 * C - 330 * ePrime2) * Math.pow(A, 6) / 720));

    if (lat < 0) {
        northing += 10000000.0; // False northing for southern hemisphere
    }

    return {
        x: easting.toFixed(2),
        y: northing.toFixed(2),
        zone: "22S"
    };
}
