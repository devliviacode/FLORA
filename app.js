//Definição
const express = require("express");
const session = require('express-session');
const app = express();
const BD = require('./db');

//Motor de conversao do HTML para o Backend
app.set("view engine", "ejs");

app.use(express.static('Public'));

//Codificação de URL
app.use(express.urlencoded({
    extended: true
}));

//Configurar o Session
app.use(session({
    secret: 'SESISENAI',
    resave: false,
    saveUninitialized: false
}));

// Página Inicial (Landing Page Institucional)
app.get("/", (req, res) => {
    res.render("landing/index");
});

// Rota Login
app.get("/login", (req, res) => {
    res.render("login", { erro: null });
});

app.post('/login', async (req, res) => {
    const { email, senha } = req.body;

    try {
        const resultado = await BD.query(`
            SELECT id_administrador, nome_administrador, email_administrador
            FROM administradores
            WHERE email_administrador = $1
              AND senha_administrador = $2
        `, [email, senha]);

        if (resultado.rows.length === 0) {
            return res.render('login', {
                erro: 'E-mail ou senha inválido!'
            });
        }

        req.session.usuario = resultado.rows[0];
        res.redirect('/dashboard');

    } catch (erro) {
        console.log('Erro no login: ' + erro);
        res.status(500).send('Erro no servidor!');
    }
});

function exigirLogin(req, res, next) {
    if (!req.session.usuario) {
        return res.redirect('/login');
    }
    next();
}

// Dashboard (Tela do Funcionário)
app.get('/dashboard', exigirLogin, async (req, res) => {
    try {
        const busca = req.query.busca || '';

        // 1. Produtos em alerta de estoque mínimo (apenas ativos)
        const alertaRes = await BD.query(`
            SELECT id_produto, nome_produto, imagem_produto, quantidade_produto, estoque_minimo
            FROM produtos
            WHERE quantidade_produto <= estoque_minimo
              AND situacao_produto ILIKE 'Ativ%'
            ORDER BY quantidade_produto ASC
            LIMIT 6
        `);

        // 2. Categorias ativas
        const categoriasRes = await BD.query(`
            SELECT id_categoria, nome_categoria
            FROM categorias
            WHERE situacao_categoria ILIKE 'Ativ%'
            ORDER BY id_categoria ASC
        `);

        // 3. Todos os produtos (ativos e inativos) — mais recentes primeiro
        const produtosRes = await BD.query(`
            SELECT id_produto, id_categoria, nome_produto, imagem_produto, quantidade_produto, valor_produto, situacao_produto
            FROM produtos
            WHERE nome_produto ILIKE $1
            ORDER BY id_produto DESC
        `, [`%${busca}%`]);

        // Agrupa todos os produtos dentro de cada categoria (sem limite de 6)
        const categoriasComProdutos = categoriasRes.rows.map(cat => ({
            ...cat,
            produtos: produtosRes.rows
                .filter(prod => prod.id_categoria === cat.id_categoria)
        }));

        res.render('dashboard', {
            usuario: req.session.usuario,
            busca,
            produtosAlerta: alertaRes.rows,
            categoriasComProdutos
        });

    } catch (erro) {
        console.error('Erro no dashboard:', erro);
        res.status(500).send('Erro ao carregar o dashboard!');
    }
});

//Rota Administrativa
app.get("/admin", exigirLogin, (req, res) => {
    res.render("admin", { usuario: req.session.usuario });
});

//Rotas Categorias
const categoriasRoutes = require('./Routes/categoriasRoutes');
app.use("/categorias", exigirLogin, categoriasRoutes);

//Rotas Movimentações de Estoque
const inscricoesRoutes = require('./Routes/moviementacoesRoutes');
app.use("/movimentacoes", exigirLogin, inscricoesRoutes);

// Rotas Produtos
const produtosRoutes = require('./Routes/produtosRoutes');
app.use("/produtos", exigirLogin, produtosRoutes);

//Rotas Usuarios
const usuariosRoutes = require('./Routes/usuariosRoutes');
app.use("/usuarios", exigirLogin, usuariosRoutes);

//Rotas Inscricao
const inscricaoRoutes = require('./Routes/inscricaoRoutes');
app.use("/inscricoes", exigirLogin, inscricaoRoutes);

//logout
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Testa a conexão com o PostgreSQL antes de iniciar o servidor.
const porta = 3001;

async function iniciarServidor() {
  try {
    const resultado = await BD.query('SELECT current_database() AS nome');

    console.log('✅ PostgreSQL conectado com sucesso!');
    console.log('📁 Banco de dados: ' + resultado.rows[0].nome);

    app.listen(porta, () => {
      console.log('✅ Servidor iniciado: http://localhost:' + porta);
    });
  } catch (erro) {
    console.error('❌ Não foi possível conectar ao PostgreSQL.');
    console.error('Motivo: ' + erro.message);
    console.error('Verifique se o PostgreSQL está ativo e confira a conexão em db.js.');

    await BD.end();
    process.exitCode = 1;
  }
}

iniciarServidor();

//fim