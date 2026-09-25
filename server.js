// V3RBOS Server
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════
// ESTADO EM MEMÓRIA
// ═══════════════════════════════════════════════════════════

const salas = {};
let filaMatchmaking = [];

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
// CONFIG VERSAO (mude aqui quando lancar nova versao)
// ═══════════════════════════════════════════════════════════

const VERSAO_ATUAL = {
    code: 2,
    nome: "1.1",
    notas: "Novos mini-games: Snake, Breakout, Flappy, Tetris e Runner! Pong 2v2 no Hotseat. Novas músicas, conquistas animadas e muito mais."
};

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
    // MATCHMAKING (com suporte a aleatorio)
    // ═══════════════════════════════════════════════════════

    if (req.method === 'POST' && pathName === '/matchmaking/entrar') {
        lerCorpo(req, body => {
            const id = body.id || '';
            const nome = body.nome || 'Jogador';
            const modo = body.modo || 'contra';
            const tamanho = parseInt(body.tamanho || 0);
            const aura = parseInt(body.aura || 0);

            if (!id) {
                responderJSON(res, { ok: false, erro: 'ID obrigatório' }, 400);
                return;
            }

            filaMatchmaking = filaMatchmaking.filter(j => j.id !== id);
            limparFilaAntiga();

            const idxOponente = filaMatchmaking.findIndex(j => {
                if (j.id === id) return false;
                if (j.modo !== modo) return false;
                if (j.tamanho === 0 || tamanho === 0) return true;
                return j.tamanho === tamanho;
            });

            if (idxOponente >= 0) {
                const oponente = filaMatchmaking[idxOponente];
                filaMatchmaking.splice(idxOponente, 1);

                let tamanhoFinal;
                if (tamanho === 0 && oponente.tamanho === 0) {
                    tamanhoFinal = 0;
                } else if (tamanho === 0) {
                    tamanhoFinal = oponente.tamanho;
                } else {
                    tamanhoFinal = tamanho;
                }

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
                    tamanho: tamanhoFinal
                };

                responderJSON(res, {
                    ok: true,
                    match: true,
                    codigo: codigo,
                    souHost: false,
                    nomeOponente: oponente.nome,
                    idOponente: oponente.id,
                    auraOponente: oponente.aura,
                    tamanhoFinal: tamanhoFinal
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
                    auraOponente: 0,
                    tamanhoFinal: s.tamanho
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
                    amigos: [],
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

    if (req.method === 'GET' && pathName === '/jogador/buscar') {
        const nome = (parsed.query.nome || '').toLowerCase();
        if (!nome) {
            responderJSON(res, { ok: false, erro: 'Nome obrigatório' }, 400);
            return;
        }
        const resultado = Object.values(jogadores)
            .filter(j => (j.nome || '').toLowerCase().includes(nome))
            .slice(0, 20);
        responderJSON(res, { ok: true, resultado: resultado });
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

    // ═══════════════════════════════════════════════════════
    // AMIGOS
    // ═══════════════════════════════════════════════════════

    if (req.method === 'POST' && pathName === '/amigo/adicionar') {
        lerCorpo(req, body => {
            const id = body.id || '';
            const amigoId = body.amigoId || '';

            if (!id || !amigoId || id === amigoId) {
                responderJSON(res, { ok: false, erro: 'IDs inválidos' }, 400);
                return;
            }
            if (!jogadores[id] || !jogadores[amigoId]) {
                responderJSON(res, { ok: false, erro: 'Jogador não encontrado' }, 404);
                return;
            }

            if (!jogadores[id].amigos) jogadores[id].amigos = [];
            if (!jogadores[id].amigos.includes(amigoId)) {
                jogadores[id].amigos.push(amigoId);
            }
            salvarJogadores();
            responderJSON(res, { ok: true });
        });
        return;
    }

    if (req.method === 'POST' && pathName === '/amigo/remover') {
        lerCorpo(req, body => {
            const id = body.id || '';
            const amigoId = body.amigoId || '';

            if (!id || !amigoId) {
                responderJSON(res, { ok: false, erro: 'IDs inválidos' }, 400);
                return;
            }
            if (jogadores[id] && jogadores[id].amigos) {
                jogadores[id].amigos = jogadores[id].amigos.filter(x => x !== amigoId);
                salvarJogadores();
            }
            responderJSON(res, { ok: true });
        });
        return;
    }

    if (req.method === 'GET' && pathName === '/amigo/lista') {
        const id = parsed.query.id || '';
        if (!id || !jogadores[id]) {
            responderJSON(res, { ok: false, erro: 'Jogador não encontrado' }, 404);
            return;
        }
        const listaIds = jogadores[id].amigos || [];
        const lista = listaIds
            .map(aid => jogadores[aid])
            .filter(j => j);
        responderJSON(res, { ok: true, amigos: lista });
        return;
    }

    // ═══════════════════════════════════════════════════════
    // DAILY CHALLENGE
    // ═══════════════════════════════════════════════════════

    if (req.method === 'GET' && pathName === '/daily') {
        const EPOCH = Date.UTC(2024, 0, 1);
        const agora = Date.now();
        const dia = Math.floor((agora - EPOCH) / 86400000);

        responderJSON(res, {
            ok: true,
            dia: dia,
            premio: 10000
        });
        return;
    }

    // ═══════════════════════════════════════════════════════
    // VERSAO (atualizacao in-app)
    // ═══════════════════════════════════════════════════════

    if (req.method === 'GET' && pathName === '/versao') {
        responderJSON(res, {
            ok: true,
            versaoCode: VERSAO_ATUAL.code,
            versaoNome: VERSAO_ATUAL.nome,
            notas: VERSAO_ATUAL.notas
        });
        return;
    }

    // ═══════════════════════════════════════════════════════
    // Rota não encontrada
    // ═══════════════════════════════════════════════════════
    responderJSON(res, { erro: 'Rota não encontrada' }, 404);
});

server.listen(PORT, () => {
    console.log('V3RBOS server rodando na porta ' + PORT);
});
