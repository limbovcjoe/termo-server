// V3RBOS Server
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SENHA_ADMIN = process.env.ADMIN_SENHA || 'v3rbos-admin-2024';

// ═══════════════════════════════════════════════════════════
// CONFIG REMOTA (muda aqui sem recompilar o app)
// ═══════════════════════════════════════════════════════════

const CONFIG = {
    modoSolo: true,
    modoHotseat: true,
    modoContra: true,
    modoVersus: true,
    modoDupla: true,
    modoDueto: true,
    modoQuarteto: true,
    modoDaily: true,

    miniPong: true,
    miniSnake: true,
    miniBreakout: true,
    miniFlappy: true,
    miniTetris: true,
    miniRunner: true,

    matchmakingAtivo: true,
    mensagemGlobal: '',
    emManutencao: false,
    mensagemManutencao: ''
};

const banidos = new Set();

// ═══════════════════════════════════════════════════════════
// ESTADO EM MEMÓRIA
// ═══════════════════════════════════════════════════════════

const salas = {};
let filaMatchmaking = [];

let jogadores = {};
const ARQUIVO_JOGADORES = path.join(__dirname, 'jogadores.json');

// ═══════════════════════════════════════════════════════════
// GITHUB PERSISTENCE
// ═══════════════════════════════════════════════════════════

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = 'limbovcjoe/v3rbos-data';
const GITHUB_ARQUIVO = 'jogadores.json';

function githubHeaders() {
    return {
        'Authorization': 'token ' + GITHUB_TOKEN,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'v3rbos-server'
    };
}

async function carregarJogadoresDoGithub() {
    if (!GITHUB_TOKEN) {
        console.log('AVISO: GITHUB_TOKEN nao configurado, usando so disco local');
        return carregarJogadoresLocal();
    }
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_ARQUIVO}`;
        const resposta = await fetch(url, { headers: githubHeaders() });
        if (!resposta.ok) {
            console.log('Github retornou ' + resposta.status + ', usando local');
            return carregarJogadoresLocal();
        }
        const dados = await resposta.json();
        const conteudo = Buffer.from(dados.content, 'base64').toString('utf8');
        jogadores = JSON.parse(conteudo || '{}');
        console.log('Jogadores carregados do GitHub: ' + Object.keys(jogadores).length);
    } catch (e) {
        console.error('Erro ao carregar do GitHub: ' + e.message);
        carregarJogadoresLocal();
    }
}

function carregarJogadoresLocal() {
    try {
        if (fs.existsSync(ARQUIVO_JOGADORES)) {
            const dados = fs.readFileSync(ARQUIVO_JOGADORES, 'utf8');
            jogadores = JSON.parse(dados || '{}');
            console.log('Jogadores carregados do disco: ' + Object.keys(jogadores).length);
        }
    } catch (e) {
        console.error('Erro ao carregar local: ' + e.message);
        jogadores = {};
    }
}

// Fila simples pra evitar commits concorrentes
let commitEmAndamento = false;
let commitAgendado = false;

async function salvarJogadores() {
    // 1. Sempre salva no disco local (rapido)
    try {
        fs.writeFileSync(ARQUIVO_JOGADORES, JSON.stringify(jogadores, null, 2));
    } catch (e) {
        console.error('Erro ao salvar local: ' + e.message);
    }

    // 2. Se já tem commit rolando, agenda mais um
    if (commitEmAndamento) {
        commitAgendado = true;
        return;
    }

    if (!GITHUB_TOKEN) return;

    commitEmAndamento = true;
    try {
        await commitParaGithub();
    } catch (e) {
        console.error('Erro no commit GitHub: ' + e.message);
    }
    commitEmAndamento = false;

    // Se tinha alguém agendado, dispara de novo
    if (commitAgendado) {
        commitAgendado = false;
        salvarJogadores();
    }
}

async function commitParaGithub() {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_ARQUIVO}`;

    // Pega o SHA atual
    let shaAtual = null;
    try {
        const atual = await fetch(url, { headers: githubHeaders() });
        if (atual.ok) {
            const dados = await atual.json();
            shaAtual = dados.sha;
        }
    } catch (_) {}

    const conteudo = Buffer.from(JSON.stringify(jogadores, null, 2)).toString('base64');

    const body = {
        message: 'sync: jogadores ' + new Date().toISOString(),
        content: conteudo,
        committer: {
            name: 'V3RBOS Server',
            email: 'server@v3rbos.local'
        }
    };
    if (shaAtual) body.sha = shaAtual;

    const resp = await fetch(url, {
        method: 'PUT',
        headers: { ...githubHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error('GitHub ' + resp.status + ': ' + txt.substring(0, 100));
    }
}

// Carrega do GitHub na inicializacao (async)
carregarJogadoresDoGithub();

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

function extrairIp(req) {
    try {
        const fwd = req.headers['x-forwarded-for'];
        if (fwd) return String(fwd).split(',')[0].trim();
        return req.connection.remoteAddress || req.socket.remoteAddress || '';
    } catch (_) {
        return '';
    }
}

function limparFilaAntiga() {
    const agora = Date.now();
    filaMatchmaking = filaMatchmaking.filter(j => (agora - j.entrouEm) < 120000);
}

// ═══════════════════════════════════════════════════════════
// CONFIG VERSAO (mude aqui quando lancar nova versao)
// ═══════════════════════════════════════════════════════════

const VERSAO_ATUAL = {
    code: 3,
    nome: "1.1.1",
    notas: "Novo mini-game secreto: Pacman! Tracking completo, painel admin, correções de bugs e mais."
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
        const ipReq = extrairIp(req);
        lerCorpo(req, body => {
            const id = body.id || '';
            const nome = body.nome || '';
            const aura = parseInt(body.aura || 0);
            const versaoCode = parseInt(body.versaoCode || 0);
            const versaoNome = body.versaoNome || '';

            if (!id) {
                responderJSON(res, { ok: false, erro: 'ID obrigatório' }, 400);
                return;
            }

            const agora = Date.now();
            if (jogadores[id]) {
                jogadores[id].nome = nome || jogadores[id].nome;
                jogadores[id].aura = aura;
                jogadores[id].ultimoAcesso = agora;
                if (ipReq) jogadores[id].ip = ipReq;
                if (versaoCode) jogadores[id].versaoCode = versaoCode;
                if (versaoNome) jogadores[id].versaoNome = versaoNome;
            } else {
                jogadores[id] = {
                    id: id,
                    nome: nome,
                    aura: aura,
                    vitorias: 0,
                    derrotas: 0,
                    empates: 0,
                    amigos: [],
                    ip: ipReq,
                    versaoCode: versaoCode,
                    versaoNome: versaoNome,
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
    // DASHBOARD HTML
    // ═══════════════════════════════════════════════════════
    if (req.method === 'GET' && pathName === '/admin') {
        try {
            const html = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(html);
        } catch (e) {
            responderJSON(res, { ok: false, erro: 'Dashboard não encontrado' }, 404);
        }
        return;
    }

    // ═══════════════════════════════════════════════════════
    // TRACKING DE EVENTOS
    // ═══════════════════════════════════════════════════════

    // POST /track/jogo — { id, modo, venceu, empate, tentativas, duracaoSeg }
    if (req.method === 'POST' && pathName === '/track/jogo') {
        lerCorpo(req, body => {
            const id = body.id || '';
            const modo = body.modo || 'solo';
            if (!id || !jogadores[id]) {
                responderJSON(res, { ok: false, erro: 'Jogador não encontrado' }, 404);
                return;
            }
            const j = jogadores[id];
            if (!j.porModo) j.porModo = {};
            if (!j.porModo[modo]) j.porModo[modo] = { jogos: 0, vitorias: 0, derrotas: 0, empates: 0 };
            j.porModo[modo].jogos++;
            if (body.empate) j.porModo[modo].empates++;
            else if (body.venceu) j.porModo[modo].vitorias++;
            else j.porModo[modo].derrotas++;

            j.ultimoAcesso = Date.now();
            salvarJogadores();
            responderJSON(res, { ok: true });
        });
        return;
    }

    // POST /track/daily — { id, acertou, tentativas }
    if (req.method === 'POST' && pathName === '/track/daily') {
        lerCorpo(req, body => {
            const id = body.id || '';
            if (!id || !jogadores[id]) {
                responderJSON(res, { ok: false, erro: 'Jogador não encontrado' }, 404);
                return;
            }
            const j = jogadores[id];
            if (!j.daily) j.daily = { jogados: 0, acertos: 0 };
            j.daily.jogados++;
            if (body.acertou) j.daily.acertos++;
            j.ultimoAcesso = Date.now();
            salvarJogadores();
            responderJSON(res, { ok: true });
        });
        return;
    }

    // POST /track/minigame — { id, jogo, score }
    if (req.method === 'POST' && pathName === '/track/minigame') {
        lerCorpo(req, body => {
            const id = body.id || '';
            const jogo = body.jogo || '';
            const score = parseInt(body.score || 0);
            if (!id || !jogadores[id] || !jogo) {
                responderJSON(res, { ok: false, erro: 'Dados inválidos' }, 400);
                return;
            }
            const j = jogadores[id];
            if (!j.minigames) j.minigames = {};
            if (!j.minigames[jogo]) j.minigames[jogo] = { jogos: 0, melhor: 0 };
            j.minigames[jogo].jogos++;
            if (score > j.minigames[jogo].melhor) j.minigames[jogo].melhor = score;
            j.ultimoAcesso = Date.now();
            salvarJogadores();
            responderJSON(res, { ok: true });
        });
        return;
    }

    // ═══════════════════════════════════════════════════════
    // DASHBOARD /admin?senha=xxx
    // ═══════════════════════════════════════════════════════
    if (req.method === 'GET' && pathName === '/admin/status') {
        const senha = parsed.query.senha || '';
        if (senha !== SENHA_ADMIN) {
            responderJSON(res, { ok: false, erro: 'Senha inválida' }, 403);
            return;
        }

        const agora = Date.now();
        const umDia = 24 * 60 * 60 * 1000;
        const seteDias = 7 * umDia;
        const trintaDias = 30 * umDia;

        const lista = Object.values(jogadores);
        const total = lista.length;
        const hoje = lista.filter(j => (agora - j.ultimoAcesso) < umDia).length;
        const semana = lista.filter(j => (agora - j.ultimoAcesso) < seteDias).length;
        const mes = lista.filter(j => (agora - j.ultimoAcesso) < trintaDias).length;

        // Por versao
        const porVersao = {};
        for (const j of lista) {
            const v = j.versaoNome || '?';
            porVersao[v] = (porVersao[v] || 0) + 1;
        }

        // Modos mais jogados
        const modos = {};
        let totalJogos = 0;
        for (const j of lista) {
            if (!j.porModo) continue;
            for (const m in j.porModo) {
                if (!modos[m]) modos[m] = { jogos: 0, vitorias: 0 };
                modos[m].jogos += j.porModo[m].jogos;
                modos[m].vitorias += j.porModo[m].vitorias;
                totalJogos += j.porModo[m].jogos;
            }
        }

        // Daily
        let dailyJogados = 0, dailyAcertos = 0;
        for (const j of lista) {
            if (j.daily) {
                dailyJogados += j.daily.jogados;
                dailyAcertos += j.daily.acertos;
            }
        }

        // Mini-games
        const minigames = {};
        for (const j of lista) {
            if (!j.minigames) continue;
            for (const g in j.minigames) {
                if (!minigames[g]) minigames[g] = { jogadores: 0, melhor: 0 };
                minigames[g].jogadores++;
                if (j.minigames[g].melhor > minigames[g].melhor) {
                    minigames[g].melhor = j.minigames[g].melhor;
                }
            }
        }

        responderJSON(res, {
            ok: true,
            total: total,
            ativosHoje: hoje,
            ativosSemana: semana,
            ativosMes: mes,
            totalJogos: totalJogos,
            porVersao: porVersao,
            modos: modos,
            daily: { jogados: dailyJogados, acertos: dailyAcertos },
            minigames: minigames
        });
        return;
    }

    // ═══════════════════════════════════════════════════════
    // CONFIG REMOTA (app checa isso ao abrir)
    // ═══════════════════════════════════════════════════════
    if (req.method === 'GET' && pathName === '/config') {
        responderJSON(res, { ok: true, config: CONFIG });
        return;
    }

    // ═══════════════════════════════════════════════════════
    // EVENTO ATIVO
    // ═══════════════════════════════════════════════════════
    if (req.method === 'GET' && pathName === '/evento') {
        responderJSON(res, {
            ok: true,
            ativo: CONFIG.evento?.ativo || false,
            titulo: CONFIG.evento?.titulo || '',
            descricao: CONFIG.evento?.descricao || '',
            multiplicadorAura: CONFIG.evento?.multiplicadorAura || 1
        });
        return;
    }

    // ═══════════════════════════════════════════════════════
    // BANIR / DESBANIR (admin)
    // ═══════════════════════════════════════════════════════
    if (req.method === 'POST' && pathName === '/admin/banir') {
        lerCorpo(req, body => {
            if ((body.senha || '') !== SENHA_ADMIN) {
                responderJSON(res, { ok: false, erro: 'Senha inválida' }, 403);
                return;
            }
            const id = body.id || '';
            if (!id) {
                responderJSON(res, { ok: false, erro: 'ID obrigatório' }, 400);
                return;
            }
            if (body.desbanir) banidos.delete(id);
            else banidos.add(id);
            responderJSON(res, { ok: true, banidos: [...banidos] });
        });
        return;
    }

    if (req.method === 'GET' && pathName === '/admin/banidos') {
        const senha = parsed.query.senha || '';
        if (senha !== SENHA_ADMIN) {
            responderJSON(res, { ok: false, erro: 'Senha inválida' }, 403);
            return;
        }
        responderJSON(res, { ok: true, banidos: [...banidos] });
        return;
    }

    // ═══════════════════════════════════════════════════════
    // ENVIAR MENSAGEM GLOBAL (admin)
    // ═══════════════════════════════════════════════════════
    if (req.method === 'POST' && pathName === '/admin/mensagem') {
        lerCorpo(req, body => {
            if ((body.senha || '') !== SENHA_ADMIN) {
                responderJSON(res, { ok: false, erro: 'Senha inválida' }, 403);
                return;
            }
            CONFIG.mensagemGlobal = body.texto || '';
            responderJSON(res, { ok: true, mensagem: CONFIG.mensagemGlobal });
        });
        return;
    }

    // ═══════════════════════════════════════════════════════
    // ATIVAR EVENTO (admin)
    // ═══════════════════════════════════════════════════════
    if (req.method === 'POST' && pathName === '/admin/evento') {
        lerCorpo(req, body => {
            if ((body.senha || '') !== SENHA_ADMIN) {
                responderJSON(res, { ok: false, erro: 'Senha inválida' }, 403);
                return;
            }
            CONFIG.evento = {
                ativo: !!body.ativo,
                titulo: body.titulo || '',
                descricao: body.descricao || '',
                multiplicadorAura: parseInt(body.multiplicadorAura || 1)
            };
            responderJSON(res, { ok: true, evento: CONFIG.evento });
        });
        return;
    }

    // ═══════════════════════════════════════════════════════
    // LIGAR/DESLIGAR MANUTENÇÃO (admin)
    // ═══════════════════════════════════════════════════════
    if (req.method === 'POST' && pathName === '/admin/manutencao') {
        lerCorpo(req, body => {
            if ((body.senha || '') !== SENHA_ADMIN) {
                responderJSON(res, { ok: false, erro: 'Senha inválida' }, 403);
                return;
            }
            CONFIG.emManutencao = !!body.ativo;
            CONFIG.mensagemManutencao = body.mensagem || '';
            responderJSON(res, { ok: true, emManutencao: CONFIG.emManutencao });
        });
        return;
    }

    // ═══════════════════════════════════════════════════════
    // LISTA COMPLETA DE JOGADORES (admin)
    // ═══════════════════════════════════════════════════════
    if (req.method === 'GET' && pathName === '/admin/jogadores') {
        const senha = parsed.query.senha || '';
        if (senha !== SENHA_ADMIN) {
            responderJSON(res, { ok: false, erro: 'Senha inválida' }, 403);
            return;
        }
        const lista = Object.values(jogadores)
            .sort((a, b) => b.ultimoAcesso - a.ultimoAcesso)
            .slice(0, 200);
        responderJSON(res, { ok: true, jogadores: lista });
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
