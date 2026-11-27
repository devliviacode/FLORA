const express = require('express');
const router = express.Router();
const BD = require('../db');

// ======================================================
// LISTAR MOVIMENTAÇÕES
// ======================================================
router.get('/', async (req, res) => {
    try {
        const busca = String(req.query.busca || '').trim();
        const tipo = String(req.query.tipo || '').trim();

        const condicoes = [];
        const parametros = [];

        if (busca) {
            parametros.push(`%${busca}%`);
            condicoes.push(`p.nome_produto ILIKE $${parametros.length}`);
        }

        if (tipo) {
            parametros.push(tipo);
            condicoes.push(`m.tipo = $${parametros.length}`);
        }

        const whereClause = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';

        const resultado = await BD.query(`
            SELECT
                m.id_movimentacao,
                m.data_movimentacao,
                m.tipo,
                m.quantidade_movimentacao,
                m.estoque_anterior,
                m.estoque_atual,
                p.nome_produto,
                a.nome_administrador
            FROM movimentacoes_estoque m
            INNER JOIN produtos p ON m.id_produto = p.id_produto
            LEFT JOIN administradores a ON m.id_administrador = a.id_administrador
            ${whereClause}
            ORDER BY m.data_movimentacao DESC, m.id_movimentacao DESC
        `, parametros);

        res.render('movimentacoes/index', {
            movimentacoes: resultado.rows,
            busca,
            tipo,
            usuario: req.session.usuario
        });
    } catch (erro) {
        console.log('Erro ao listar movimentações: ' + erro);
        res.status(500).send('Erro ao carregar movimentações de estoque');
    }
});

// ======================================================
// ABRIR FORMULÁRIO DE NOVA MOVIMENTAÇÃO
// ======================================================
router.get('/novo', async (req, res) => {
    try {
        const produtosRes = await BD.query(`
            SELECT id_produto, nome_produto, quantidade_produto
            FROM produtos
            WHERE situacao_produto ILIKE 'Ativ%'
            ORDER BY nome_produto ASC
        `);

        res.render('movimentacoes/novo', {
            produtos: produtosRes.rows,
            usuario: req.session.usuario,
            erro: null
        });
    } catch (erro) {
        console.log('Erro ao abrir nova movimentação: ' + erro);
        res.status(500).send('Erro ao abrir formulário de movimentação');
    }
});

// ======================================================
// SALVAR NOVA MOVIMENTAÇÃO E ATUALIZAR ESTOQUE
// ======================================================
router.post('/novo', async (req, res) => {
    try {
        const {
            id_produto,
            tipo,
            quantidade_movimentacao,
            data_movimentacao
        } = req.body;

        const qtd = Number(quantidade_movimentacao);
        const idAdmin = req.session.usuario ? req.session.usuario.id_administrador : null;

        const prodRes = await BD.query(
            'SELECT quantidade_produto FROM produtos WHERE id_produto = $1',
            [id_produto]
        );

        if (prodRes.rows.length === 0) {
            return res.status(404).send('Produto não encontrado');
        }

        const estoqueAnterior = Number(prodRes.rows[0].quantidade_produto);

        if (tipo === 'Saída' && qtd > estoqueAnterior) {
            const produtosRes = await BD.query(`
                SELECT id_produto, nome_produto, quantidade_produto
                FROM produtos
                WHERE situacao_produto ILIKE 'Ativ%'
                ORDER BY nome_produto ASC
            `);

            return res.render('movimentacoes/novo', {
                produtos: produtosRes.rows,
                usuario: req.session.usuario,
                erro: `Estoque insuficiente! Este produto possui apenas ${estoqueAnterior} unidade(s).`
            });
        }

        const estoqueAtual = tipo === 'Entrada'
            ? estoqueAnterior + qtd
            : estoqueAnterior - qtd;

        await BD.query(`
            INSERT INTO movimentacoes_estoque (
                id_produto,
                id_administrador,
                tipo,
                quantidade_movimentacao,
                estoque_anterior,
                estoque_atual,
                data_movimentacao
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            id_produto,
            idAdmin,
            tipo,
            qtd,
            estoqueAnterior,
            estoqueAtual,
            data_movimentacao
        ]);

        await BD.query(`
            UPDATE produtos
            SET quantidade_produto = $1
            WHERE id_produto = $2
        `, [estoqueAtual, id_produto]);

        res.redirect('/movimentacoes');
    } catch (erro) {
        console.log('Erro ao registrar movimentação: ' + erro);
        res.status(500).send('Erro ao registrar movimentação');
    }
});

// ======================================================
// ABRIR FORMULÁRIO DE EDITAR MOVIMENTAÇÃO
// ======================================================
router.get('/editar/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const movRes = await BD.query(`
            SELECT *
            FROM movimentacoes_estoque
            WHERE id_movimentacao = $1
        `, [id]);

        if (movRes.rows.length === 0) {
            return res.status(404).send('Movimentação não encontrada');
        }

        const produtosRes = await BD.query(`
            SELECT id_produto, nome_produto, quantidade_produto
            FROM produtos
            ORDER BY nome_produto ASC
        `);

        res.render('movimentacoes/editar', {
            movimentacao: movRes.rows[0],
            produtos: produtosRes.rows,
            usuario: req.session.usuario,
            erro: null
        });
    } catch (erro) {
        console.log('Erro ao carregar movimentação: ' + erro);
        res.status(500).send('Erro ao carregar movimentação');
    }
});

// ======================================================
// ATUALIZAR MOVIMENTAÇÃO E RECALCULAR ESTOQUE
// ======================================================
router.post('/editar/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            id_produto,
            tipo,
            quantidade_movimentacao,
            data_movimentacao
        } = req.body;

        const movAntigaRes = await BD.query(
            'SELECT * FROM movimentacoes_estoque WHERE id_movimentacao = $1',
            [id]
        );

        if (movAntigaRes.rows.length === 0) {
            return res.status(404).send('Movimentação não encontrada');
        }

        const antiga = movAntigaRes.rows[0];
        const qtdNova = Number(quantidade_movimentacao);

        // 1. Estorna o efeito da movimentação antiga no produto original
        const estornoAntigo = antiga.tipo === 'Entrada'
            ? -Number(antiga.quantidade_movimentacao)
            : Number(antiga.quantidade_movimentacao);

        await BD.query(`
            UPDATE produtos
            SET quantidade_produto = GREATEST(0, quantidade_produto + $1)
            WHERE id_produto = $2
        `, [estornoAntigo, antiga.id_produto]);

        // 2. Lê o saldo já estornado do produto selecionado e calcula o novo saldo
        const prodRes = await BD.query(
            'SELECT quantidade_produto FROM produtos WHERE id_produto = $1',
            [id_produto]
        );

        const estoqueAnterior = Number(prodRes.rows[0].quantidade_produto);
        const estoqueAtual = tipo === 'Entrada'
            ? estoqueAnterior + qtdNova
            : Math.max(0, estoqueAnterior - qtdNova);

        await BD.query(`
            UPDATE produtos
            SET quantidade_produto = $1
            WHERE id_produto = $2
        `, [estoqueAtual, id_produto]);

        // 3. Atualiza o registro da movimentação
        await BD.query(`
            UPDATE movimentacoes_estoque
            SET
                id_produto = $1,
                tipo = $2,
                quantidade_movimentacao = $3,
                estoque_anterior = $4,
                estoque_atual = $5,
                data_movimentacao = $6
            WHERE id_movimentacao = $7
        `, [
            id_produto,
            tipo,
            qtdNova,
            estoqueAnterior,
            estoqueAtual,
            data_movimentacao,
            id
        ]);

        res.redirect('/movimentacoes');
    } catch (erro) {
        console.log('Erro ao atualizar movimentação: ' + erro);
        res.status(500).send('Erro ao atualizar movimentação');
    }
});

// ======================================================
// EXCLUIR MOVIMENTAÇÃO E ESTORNAR ESTOQUE
// ======================================================
router.get('/excluir/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const movRes = await BD.query(
            'SELECT * FROM movimentacoes_estoque WHERE id_movimentacao = $1',
            [id]
        );

        if (movRes.rows.length > 0) {
            const mov = movRes.rows[0];
            const estorno = mov.tipo === 'Entrada'
                ? -Number(mov.quantidade_movimentacao)
                : Number(mov.quantidade_movimentacao);

            await BD.query(`
                UPDATE produtos
                SET quantidade_produto = GREATEST(0, quantidade_produto + $1)
                WHERE id_produto = $2
            `, [estorno, mov.id_produto]);

            await BD.query('DELETE FROM movimentacoes_estoque WHERE id_movimentacao = $1', [id]);
        }

        res.redirect('/movimentacoes');
    } catch (erro) {
        console.log('Erro ao excluir movimentação: ' + erro);
        res.status(500).send('Erro ao excluir movimentação');
    }
});

module.exports = router;