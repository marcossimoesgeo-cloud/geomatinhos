/**
 * Geoportal Matinhos - Configuração de Estilos e Metadados
 * Secretaria Municipal de Urbanismo e Planejamento Urbano - Prefeitura de Matinhos
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
        x: easting.toFixed(3),
        y: northing.toFixed(3),
        easting: easting,
        northing: northing,
        x2: easting.toFixed(2),
        y2: northing.toFixed(2),
        x3: easting.toFixed(3),
        y3: northing.toFixed(3),
        zone: "22S"
    };
}


const LOTEAMENTO_COLORS = {
    "97A - Rio da Onça": "#d7191c",
    "Planta 01 - Johanes Max Roesner": "#d81d1e",
    "Planta 02 - 1º Loteamento Carlos Ihle": "#d92120",
    "Planta 03 - 2º Loteamento Carlos Ihle": "#da2522",
    "Planta 05 - Balneário Matinhos": "#db2924",
    "Planta 05 - Cidade Balneária Caiubá - Parte 1": "#dc2d25",
    "Planta 05 - Cidade Balneária Caiubá - Parte 2": "#dd3127",
    "Planta 07 - Boqueirão de Matinhos": "#de3529",
    "Planta 08 - Jacinto Mesquita": "#df392b",
    "Planta 09 - João Jacinto Mesquita": "#e03d2d",
    "Planta 10 - Vila Hermes": "#e1422f",
    "Planta 100 - Cohapar II": "#e24631",
    "Planta 105- Levi Alves (Desm. lote 16H)": "#e34a33",
    "Planta 108- Marino Pereira": "#e44e34",
    "Planta 11 - Vila Paraíso": "#e55236",
    "Planta 110 - Santa Lúcia": "#e75638",
    "Planta 114- São Domingos": "#e85a3a",
    "Planta 115- Colônia dos Pescadores": "#e95e3c",
    "Planta 116 - Baln. Jardim Monções II": "#ea623e",
    "Planta 117 - Parque Balneário Portal das Praias de Matinhos": "#eb6640",
    "Planta 118 - Antenor Vieira Barradas": "#ec6a42",
    "Planta 119 - Neumar": "#ed6e43",
    "Planta 12 - Bela Vista": "#ee7245",
    "Planta 120 - Lages e Corais (Artezor Toniolo)": "#ef7647",
    "Planta 121 - Portal das Praias de Matinhos I": "#f07a49",
    "Planta 122 - Banhomar": "#f17e4b",
    "Planta 123 - Mangue Seco": "#f2824d",
    "Planta 124 - Vila Municipal": "#f3864f",
    "Planta 126 - Jordão": "#f48b51",
    "Planta 129-Flamingo (Desm. A2-5)": "#f58f52",
    "Planta 13 - Manoel Ferreira Gomes": "#f69354",
    "Planta 130- LART Lote C20B2": "#f79756",
    "Planta 131-LART Lote C20B3": "#f89b58",
    "Planta 134 - Alípio Santos Filho - MAT. 25102": "#f99f5a",
    "Planta 135-Flamingo B (Salmoria A2-B2)": "#faa35c",
    "Planta 136- Jardim das Orquídeas": "#fba75e",
    "Planta 137 - Cohapar II Área Verde": "#fcab60",
    "Planta 138- Jacinto Mesquita de Souza": "#fdaf62",
    "Planta 14 - Felipe Mendes": "#fdb164",
    "Planta 141 - Marino Pereira \"A\" - MAT. 42575/G": "#fdb367",
    "Planta 15 - Sertãozinho": "#fdb569",
    "Planta 150 - Tabuleiro": "#fdb76c",
    "Planta 152 - Vila Nova": "#fdba6e",
    "Planta 155 - Jardim Scheffer": "#fdbc71",
    "Planta 158 - Gleba Jacarandá": "#fdbe74",
    "Planta 16 - Bom Retiro": "#fdc076",
    "Planta 164-Mangue Seco (Moradia Legal)": "#fec279",
    "Planta 168 - Nossa Senhora Aparecida": "#fec57b",
    "Planta 17 - Caiçara": "#fec77e",
    "Planta 18- Jardim Santa Rosa I": "#fec980",
    "Planta 184 - Jardim Ross II": "#fecb83",
    "Planta 19 - Jardim Alvorada": "#fecd85",
    "Planta 209- Jardim Santa Rosa II": "#fed088",
    "Planta 21 - Santa Rita de Cássia": "#fed28b",
    "Planta 212-Bahr (Lote 2C)": "#fed48d",
    "Planta 22 - Jardim Yemanjá": "#fed690",
    "Planta 23-Maristela": "#fed892",
    "Planta 24 - Maria Madalena da Costa Ferreira": "#fedb95",
    "Planta 25 - Rosa Ferreira Gomes": "#fedd97",
    "Planta 26 - Vila Lica": "#fedf9a",
    "Planta 27 - Manoel Júlio I": "#fee19c",
    "Planta 28 - Manoel Júlio II": "#fee39f",
    "Planta 29 - Fernando Afonso Alves de Camargo": "#fee6a2",
    "Planta 30 - Jardim das Palmeiras": "#fee8a4",
    "Planta 31 - São Sebastião": "#feeaa7",
    "Planta 32 - Balneário Riviera": "#ffeca9",
    "Planta 32 - Balneário Riviera B": "#ffeeac",
    "Planta 33 - Balneário Praia Grande Parte 1": "#fff1ae",
    "Planta 33 - Balneário Praia Grande Parte 2": "#fff3b1",
    "Planta 34- Balneário Flórida": "#fff5b3",
    "Planta 35 - Balneário Costa Azul": "#fff7b6",
    "Planta 36 - União dos Ferroviários do Brasil": "#fff9b9",
    "Planta 37 - Balneário Inajá": "#fffcbb",
    "Planta 38 - Balneário Marajó": "#fffebe",
    "Planta 38 - José Dias da Silva": "#feffbf",
    "Planta 39 - Balneário Solymar": "#fcfebe",
    "Planta 40 - Praia das Betaras Parte 1": "#f9fdbd",
    "Planta 40 - Praia das Betaras Parte 2": "#f7fcbc",
    "Planta 40 - Praia das Betaras Parte 3": "#f5fbbc",
    "Planta 41 - Balneário Ipacaraí Parte I": "#f2fabb",
    "Planta 41A - Balneário Ipacaraí Parte II": "#f0f9ba",
    "Planta 42- Balneário Perequê Parte I": "#eef8b9",
    "Planta 42A- Balneário Perequê Parte II-Fig.A": "#ecf7b9",
    "Planta 42C- Balneário Perequê Parte III-Fig.C": "#e9f6b8",
    "Planta 43 - Balneário Guaciara Parte I": "#e7f5b7",
    "Planta 43A - Balneário Guaciara Parte II": "#e5f4b7",
    "Planta 44 - Praia das Gaivotas I": "#e2f3b6",
    "Planta 44A (176) - Praia das Gaivotas II Lote B2A": "#e0f3b5",
    "Planta 44B (177) - Praia das Gaivotas III Lote C3 Parte A": "#def2b4",
    "Planta 44C (178) - Praia das Gaivotas IV Lote C3 Parte B": "#dcf1b4",
    "Planta 44D (179) - Praia das Gaivotas V Lote B2": "#d9f0b3",
    "Planta 45 - Balneário Iracema": "#d7efb2",
    "Planta 45 - Balneário Iracema 01": "#d5eeb1",
    "Planta 46 - Jardim Monções": "#d2edb1",
    "Planta 47- Patrício da Silva": "#d0ecb0",
    "Planta 47A- Ciro Macalossi": "#ceebaf",
    "Planta 48 - Vila América": "#cceaae",
    "Planta 50 - Máximo da Silva Ramos": "#c9e9ae",
    "Planta 51 - Francisco Mesquita": "#c7e8ad",
    "Planta 52 - Derder": "#c5e7ac",
    "Planta 53 - Gabriel Mesquita": "#c2e6ac",
    "Planta 54 - Balneário Caravella II": "#c0e6ab",
    "Planta 55 - Balneário Caravella I": "#bee5aa",
    "Planta 56 - Jardim Presidente Vargas": "#bce4a9",
    "Planta 57 - Baln. Céu Azul": "#b9e3a9",
    "Planta 59 - Adelaide Nico Scorsin": "#b7e2a8",
    "Planta 60 Jardim Oito Vilas": "#b5e1a7",
    "Planta 61 - Balneário Currais": "#b2e0a6",
    "Planta 62 - Leonor Albini Teixeira": "#b0dfa6",
    "Planta 63 - Balneário Junara": "#aedea5",
    "Planta 65 - Jardim São Francisco": "#acdda4",
    "Planta 66 - Jardim Bernardina": "#a8dba4",
    "Planta 67 - Baln. Corais": "#a5d9a5",
    "Planta 68 - Jardim Flamingo": "#a1d6a6",
    "Planta 69 - Jardim Ross I": "#9ed4a6",
    "Planta 70- Jardim João Júlio Viana": "#9ad1a7",
    "Planta 71 - Vila São Pedro": "#97cfa7",
    "Planta 72 Sebastião Silvestre Vianna": "#93cca8",
    "Planta 73 - Baln. Arco-Íris": "#90caa9",
    "Planta 74 - Balneário Saint Etienne": "#8dc8a9",
    "Planta 76 - Jardim Santana": "#89c5aa",
    "Planta 77- Balneário Jamail Mar": "#86c3aa",
    "Planta 79 - Balneário Albatroz": "#82c0ab",
    "Planta 80 - Jardim Eliza": "#7fbeac",
    "Planta 81 - Jardim Santa Maria": "#7bbbac",
    "Planta 82 - Balneário Eldorado I": "#78b9ad",
    "Planta 82 - Balneário Eldorado II": "#74b6ad",
    "Planta 84- Francisco dos Santos Jr.": "#71b4ae",
    "Planta 85 - João Carraro": "#6db2af",
    "Planta 86 - Balneário dos Corais": "#6aafaf",
    "Planta 87 - Vila Mesquita Alboit": "#66adb0",
    "Planta 88-São Guido": "#63aab0",
    "Planta 89- Jardim Lídio Júlio Viana": "#5fa8b1",
    "Planta 90- Elízio Júlio Viana": "#5ca5b2",
    "Planta 92 - Celina Mendes": "#58a3b2",
    "Planta 93-Jardim Pavin": "#55a0b3",
    "Planta 95 - Jardim Aurora": "#519eb3",
    "Planta 96 - Jardim Flamingo I Área A2-4": "#4e9bb4",
    "Planta 97 - Jardim Colina Verde": "#4a99b5",
    "Planta 97A- Rio da Onça 16A": "#4797b5",
    "Planta 98 - Sol e Mar Parte I": "#4394b6",
    "Planta 99 - Sol e Mar Parte II": "#4092b6",
    "Planta 99A-Plínio Alves Viana": "#3c8fb7",
    "Planta A1B- Baln. Currais": "#398db8",
    "Planta A2B- Baln. Currais": "#358ab8",
    "Planta A3B- Baln. Currais": "#3288b9",
    "Planta A4B- Baln. Currais": "#2e85b9",
    "NULL": "#2b83ba"
};
