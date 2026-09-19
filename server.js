const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3000;

// Salas em memória
// Estrutura: { codigo: { jogador1, jogador2, mensagens: [] } }
const salas = {};

// Gera código de 4 letras maiúsculas
function gerarCodigo() {
    const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let codigo = '';
    for (let i = 0; i < 4; i++) {
        codigo += letras.charAt(Math.floor(Math.random() * letras.length));
    }
    return codigo;
}

// Responde JSON
function responderJSON(res, obj, status) {
    res.writeHead(status || 200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(obj));
}

// Lê o corpo da requisição (JSON)
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

const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const path = parsed.pathname;

    // GET /  → status
    if (req.method === 'GET' && path === '/') {
        responderJSON(res, { status: 'ok', salas: Object.keys(salas).length });
        return;
    }

    // POST /criar  → cria sala, retorna código
    if (req.method === 'POST' && path === '/criar') {
        lerCorpo(req, body => {
            const nome = body.nome || 'Jogador 1';
            let codigo = gerarCodigo();
            // Garante que não existe
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

    // POST /entrar  → entra em sala existente
    if (req.method === 'POST' && path === '/entrar') {
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

    // POST /enviar  → manda mensagem
    if (req.method === 'POST' && path === '/enviar') {
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

    // GET /buscar?codigo=XXXX&desde=N  → mensagens novas
    if (req.method === 'GET' && path === '/buscar') {
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

    // POST /sair  → remove sala
    if (req.method === 'POST' && path === '/sair') {
        lerCorpo(req, body => {
            const codigo = (body.codigo || '').toUpperCase();
            if (salas[codigo]) {
                delete salas[codigo];
            }
            responderJSON(res, { ok: true });
        });
        return;
    }

    // Rota não encontrada
    responderJSON(res, { erro: 'Rota não encontrada' }, 404);
});

server.listen(PORT, () => {
    console.log('Termo server rodando na porta ' + PORT);
});
