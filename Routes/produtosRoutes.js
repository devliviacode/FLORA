const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const BD = require('../db');

// Garante que a pasta de upload exista
const pastaUpload = path.join(__dirname, '..', 'Public', 'img', 'upload');
fs.mkdirSync(pastaUpload, { recursive: true });

// Configuração do Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, pastaUpload);
    },
    filename: (req, file, cb) => {
        const extensao = path.extname(file.originalname);
        const nomeUnico = Date.now() + '-' + Math.round(Math.random() * 1E9) + extensao;
        cb(null, nomeUnico);
    }
});
const upload = multer({ storage });

// ======================================================
// LISTAR (REDIRECIONA PARA O DASHBOARD)
// ======================================================
router.get('/', (req, res) => {
    res.redirect('/dashboard');
});

// ======================================================
// ABRIR FORMULÁRIO DE CADASTRAR PRODUTO
// ======================================================
router.get('/novo', async (req, res) => {
    try {
        const categorias = await BD.query(`
            SELECT id_categoria, nome_categoria
            FROM categorias
            WHERE situacao_categoria ILIKE 'Ativ%'
            ORDER BY nome_categoria ASC
        `);

        res.render('produtos/novo', {
            categorias: categorias.rows,
            usuario: req.session.usuario
        });
    } catch (erro) {
        console.log('Erro ao abrir cadastro de produto: ' + erro);
        res.status(500).send('Erro ao abrir cadastro de produto');
    }
});

// ======================================================
// CADASTRAR PRODUTO
// ======================================================
router.post('/novo', upload.single('imagem_produto'), async (req, res) => {
    try {
        const {
            id_categoria,
            nome_produto,
            descricao_produto,
            quantidade_produto,
            estoque_minimo,
            valor_produto,
            situacao_produto
        } = req.body;

        const imagem_produto = req.file ? req.file.filename : 'sem-imagem.jpg';

        // Calcula o próximo ID disponível para a tabela produtos
        const idRes = await BD.query('SELECT COALESCE(MAX(id_produto), 0) + 1 AS proximo_id FROM produtos');
        const proximoId = idRes.rows[0].proximo_id;

        await BD.query(`
            INSERT INTO produtos (
                id_produto,
                id_categoria,
                nome_produto,
                descricao_produto,
                quantidade_produto,
                estoque_minimo,
                valor_produto,
                imagem_produto,
                situacao_produto
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
            proximoId,
            Number(id_categoria),
            nome_produto,
            descricao_produto || null,
            Number(quantidade_produto),
            Number(estoque_minimo),
            Number(valor_produto),
            imagem_produto,
            situacao_produto || 'Ativo'
        ]);

        res.redirect('/dashboard');
    } catch (erro) {
        console.log('Erro ao cadastrar produto: ' + erro);
        res.status(500).send('Erro ao cadastrar produto');
    }
});

// ======================================================
// ABRIR FORMULÁRIO DE EDITAR PRODUTO
// ======================================================
router.get('/editar/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const produtoRes = await BD.query(`
            SELECT *
            FROM produtos
            WHERE id_produto = $1
        `, [id]);

        if (produtoRes.rows.length === 0) {
            return res.status(404).send('Produto não encontrado');
        }

        const categoriasRes = await BD.query(`
            SELECT id_categoria, nome_categoria
            FROM categorias
            WHERE situacao_categoria ILIKE 'Ativ%'
            ORDER BY nome_categoria ASC
        `);

        res.render('produtos/editar', {
            produto: produtoRes.rows[0],
            categorias: categoriasRes.rows,
            usuario: req.session.usuario
        });
    } catch (erro) {
        console.log('Erro ao abrir edição de produto: ' + erro);
        res.status(500).send('Erro ao carregar dados do produto');
    }
});

// ======================================================
// ATUALIZAR PRODUTO NO BANCO
// ======================================================
router.post('/editar/:id', upload.single('imagem_produto'), async (req, res) => {
    try {
        const { id } = req.params;

        const {
            id_categoria,
            nome_produto,
            descricao_produto,
            quantidade_produto,
            estoque_minimo,
            valor_produto,
            situacao_ativo,
            imagem_atual
        } = req.body;

        const imagem_produto = req.file ? req.file.filename : imagem_atual;
        const situacao_produto = situacao_ativo ? 'Ativo' : 'Inativo';

        await BD.query(`
            UPDATE produtos
            SET
                id_categoria = $1,
                nome_produto = $2,
                descricao_produto = $3,
                quantidade_produto = $4,
                estoque_minimo = $5,
                valor_produto = $6,
                imagem_produto = $7,
                situacao_produto = $8
            WHERE id_produto = $9
        `, [
            Number(id_categoria),
            nome_produto,
            descricao_produto || null,
            Number(quantidade_produto),
            Number(estoque_minimo),
            Number(valor_produto),
            imagem_produto,
            situacao_produto,
            id
        ]);

        res.redirect('/dashboard');
    } catch (erro) {
        console.log('Erro ao atualizar produto: ' + erro);
        res.status(500).send('Erro ao atualizar produto');
    }
});

// ======================================================
// EXCLUIR PRODUTO
// ======================================================
router.post('/excluir/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Remove movimentações vinculadas ao produto antes de apagá-lo
        await BD.query('DELETE FROM movimentacoes_estoque WHERE id_produto = $1', [id]);

        // Exclui o produto
        await BD.query('DELETE FROM produtos WHERE id_produto = $1', [id]);

        res.redirect('/dashboard');
    } catch (erro) {
        console.log('Erro ao excluir produto: ' + erro);
        res.status(500).send('Erro ao excluir produto');
    }
});

module.exports = router;