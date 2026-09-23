// V3RBOS Server
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════
// ESTADO EM MEMÓRIA
// ═══════════════════════════════════════════════════════════

// Salas: { codigo: { jogador1, jogador2, mensagens: [] } }
const salas = {};

// Fila de matchmaking: [{ id, nome, modo, tamanho, aura, entrouEm }]
let filaMatchmaking = [];

// Jogadores (persistidos em JSON)
let jogadores = {};
const ARQUIVO_JOGADORES = path.join(__dirname, 'jogadores.json');

function carregarJogadores() {
    try {
        if (fs.existsSync(ARQUIVO_JOGADORES)) {
            const dados = fs.readFileSync(ARQUIVO_JOGADORES, 'utf8');
            jogadores = JSON.parse(dados || '{}');
            console.log('Jogadores carregados: ' + Object.keys(jogadores).length);
        }
    } catch (e) {
        console.error('Erro ao carregar jogadores: ' + e.message);
        jogadores = {};
    }
}

function salvarJogadores() {
    try {
        fs.writeFileSync(ARQUIVO_JOGADORES, JSON.stringify(jogadores, null, 2));
    } catch (e) {
        console.error('Erro ao salvar jogadores: ' + e.message);
    }
}

carregarJogadores();

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function gerarCodigo() {
    const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let codigo = '';
    for (let i = 0; i < 4; i++) {
        codigo += letras.charAt(Math.floor(Math.random() * letras.length));
    }
    return codigo;
}

function responderJSON(res, obj, status) {
    res.writeHead(status || 200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(obj));
}

function lerCorpo(req, callback) {
    let corpo = '';
    req.on('data', chunk => { corpo += chunk; });
    req.on('end', () => {
        try {
            callback(JSON.parse(corpo || '{}'));
        } catch (e) {
            callback({});
        }
    });
}

function limparFilaAntiga() {
    const agora = Date.now();
    filaMatchmaking = filaMatchmaking.filter(j => (agora - j.entrouEm) < 120000);
}

// ═══════════════════════════════════════════════════════════
// SERVER
// ═══════════════════════════════════════════════════════════

const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const pathName = parsed.pathname;

    // GET / → status
    if (req.method === 'GET' && pathName === '/') {
        responderJSON(res, {
            status: 'ok',
            salas: Object.keys(salas).length,
            jogadores: Object.keys(jogadores).length,
            fila: filaMatchmaking.length
        });
        return;
    }

    // ═══════════════════════════════════════════════════════
    // SALAS
    // ═══════════════════════════════════════════════════════

    if (req.method === 'POST' && pathName === '/criar') {
        lerCorpo(req, body => {
            const nome = body.nome || 'Jogador 1';
            let codigo = gerarCodigo();
            while (salas[codigo]) codigo = gerarCodigo();

            salas[codigo] = {
                jogador1: nome,
                jogador2: null,
                mensagens: [],
                criadoEm: Date.now()
            };

            responderJSON(res, { ok: true, codigo: codigo });
        });
        return;
    }

    if (req.method === 'POST' && pathName === '/entrar') {
        lerCorpo(req, body => {
            const codigo = (body.codigo || '').toUpperCase();
            const nome = body.nome || 'Jogador 2';

            if (!salas[codigo]) {
                responderJSON(res, { ok: false, erro: 'Sala não existe' }, 404);
                return;
            }

            if (salas[codigo].jogador2) {
                responderJSON(res, { ok: false, erro: 'Sala cheia' }, 403);
                return;
            }

            salas[codigo].jogador2 = nome;
            salas[codigo].mensagens.push({
                de: 'sistema',
                texto: nome + ' entrou na sala',
                em: Date.now()
            });

            responderJSON(res, { ok: true, codigo: codigo });
        });
        return;
    }

    if (req.method === 'POST' && pathName === '/enviar') {
        lerCorpo(req, body => {
            const codigo = (body.codigo || '').toUpperCase();
            const de = body.de || 'desconhecido';
            const texto = body.texto || '';

            if (!salas[codigo]) {
                responderJSON(res, { ok: false, erro: 'Sala não existe' }, 404);
                return;
            }

            salas[codigo].mensagens.push({
                de: de,
                texto: texto,
                em: Date.now()
            });

            responderJSON(res, { ok: true });
        });
        return;
    }

    if (req.method === 'GET' && pathName === '/buscar') {
        const codigo = (parsed.query.codigo || '').toUpperCase();
        const desde = parseInt(parsed.query.desde || '0');

        if (!salas[codigo]) {
            responderJSON(res, { ok: false, erro: 'Sala não existe' }, 404);
            return;
        }

        const novas = salas[codigo].mensagens.slice(desde);

        responderJSON(res, {
            ok: true,
            mensagens: novas,
            total: salas[codigo].mensagens.length,
            jogador1: salas[codigo].jogador1,
            jogador2: salas[codigo].jogador2
        });
        return;
    }

    if (req.method === 'POST' && pathName === '/sair') {
        lerCorpo(req, body => {
            const codigo = (body.codigo || '').toUpperCase();
            if (salas[codigo]) {
                delete salas[codigo];
            }
            responderJSON(res, { ok: true });
        });
        return;
    }

    // ═══════════════════════════════════════════════════════
    // MATCHMAKING
    // ═══════════════════════════════════════════════════════

    if (req.method === 'POST' && pathName === '/matchmaking/entrar') {
        lerCorpo(req, body => {
            const id = body.id || '';
            const nome = body.nome || 'Jogador';
            const modo = body.modo || 'contra';
            const tamanho = parseInt(body.tamanho || 5);
            const aura = parseInt(body.aura || 0);

            if (!id) {
                responderJSON(res, { ok: false, erro: 'ID obrigatório' }, 400);
                return;
            }

            filaMatchmaking = filaMatchmaking.filter(j => j.id !== id);
            limparFilaAntiga();

            const idxOponente = filaMatchmaking.findIndex(j =>
                j.modo === modo && j.tamanho === tamanho && j.id !== id
            );

            if (idxOponente >= 0) {
                const oponente = filaMatchmaking[idxOponente];
                filaMatchmaking.splice(idxOponente, 1);

                let codigo = gerarCodigo();
                while (salas[codigo]) codigo = gerarCodigo();

                salas[codigo] = {
                    jogador1: oponente.nome,
                    jogador2: nome,
                    mensagens: [],
                    criadoEm: Date.now(),
                    matchmaking: true,
                    idJog1: oponente.id,
                    idJog2: id,
                    modo: modo,
                    tamanho: tamanho
                };

                responderJSON(res, {
                    ok: true,
                    match: true,
                    codigo: codigo,
                    souHost: false,
                    nomeOponente: oponente.nome,
                    idOponente: oponente.id,
                    auraOponente: oponente.aura
                });
                return;
            }

            filaMatchmaking.push({
                id: id,
                nome: nome,
                modo: modo,
                tamanho: tamanho,
                aura: aura,
                entrouEm: Date.now()
            });

            responderJSON(res, { ok: true, match: false });
        });
        return;
    }

    if (req.method === 'GET' && pathName === '/matchmaking/status') {
        const id = parsed.query.id || '';
        if (!id) {
            responderJSON(res, { ok: false, erro: 'ID obrigatório' }, 400);
            return;
        }

        for (const codigo in salas) {
            const s = salas[codigo];
            if (s.matchmaking && s.idJog1 === id && s.jogador2) {
                filaMatchmaking = filaMatchmaking.filter(j => j.id !== id);

                responderJSON(res, {
                    ok: true,
                    match: true,
                    codigo: codigo,
                    souHost: true,
                    nomeOponente: s.jogador2,
                    idOponente: s.idJog2 || '',
                    auraOponente: 0
                });
                return;
            }
        }

        const estou = filaMatchmaking.find(j => j.id === id);
        if (estou) {
            responderJSON(res, { ok: true, match: false, naFila: true });
        } else {
            responderJSON(res, { ok: true, match: false, naFila: false });
        }
        return;
    }

    if (req.method === 'POST' && pathName === '/matchmaking/sair') {
        lerCorpo(req, body => {
            const id = body.id || '';
            filaMatchmaking = filaMatchmaking.filter(j => j.id !== id);
            responderJSON(res, { ok: true });
        });
        return;
    }

    // ═══════════════════════════════════════════════════════
    // JOGADORES
    // ═══════════════════════════════════════════════════════

    if (req.method === 'POST' && pathName === '/jogador/registrar') {
        lerCorpo(req, body => {
            const id = body.id || '';
            const nome = body.nome || '';
            const aura = parseInt(body.aura || 0);

            if (!id) {
                responderJSON(res, { ok: false, erro: 'ID obrigatório' }, 400);
                return;
            }

            const agora = Date.now();
            if (jogadores[id]) {
                jogadores[id].nome = nome || jogadores[id].nome;
                jogadores[id].aura = aura;
                jogadores[id].ultimoAcesso = agora;
            } else {
                jogadores[id] = {
                    id: id,
                    nome: nome,
                    aura: aura,
                    vitorias: 0,
                    derrotas: 0,
                    empates: 0,
                    criadoEm: agora,
                    ultimoAcesso: agora
                };
            }

            salvarJogadores();
            responderJSON(res, { ok: true, jogador: jogadores[id] });
        });
        return;
    }

    if (req.method === 'GET' && pathName === '/jogador') {
        const id = parsed.query.id || '';
        if (!id || !jogadores[id]) {
            responderJSON(res, { ok: false, erro: 'Jogador não encontrado' }, 404);
            return;
        }
        responderJSON(res, { ok: true, jogador: jogadores[id] });
        return;
    }

    if (req.method === 'POST' && pathName === '/jogador/resultado') {
        lerCorpo(req, body => {
            const id = body.id || '';
            if (!id || !jogadores[id]) {
                responderJSON(res, { ok: false, erro: 'Jogador não encontrado' }, 404);
                return;
            }

            if (body.empate) {
                jogadores[id].empates++;
            } else if (body.venceu) {
                jogadores[id].vitorias++;
            } else {
                jogadores[id].derrotas++;
            }

            jogadores[id].ultimoAcesso = Date.now();
            salvarJogadores();

            responderJSON(res, { ok: true, jogador: jogadores[id] });
        });
        return;
    }

    if (req.method === 'GET' && pathName === '/ranking') {
        const limite = parseInt(parsed.query.limite || '10');
        const lista = Object.values(jogadores)
            .sort((a, b) => b.vitorias - a.vitorias)
            .slice(0, limite);

        responderJSON(res, { ok: true, ranking: lista });
        return;
    }

    responderJSON(res, { erro: 'Rota não encontrada' }, 404);
});

server.listen(PORT, () => {
    console.log('V3RBOS server rodando na porta ' + PORT);
});
