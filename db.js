const {Pool} = require("pg");

const BD = new  Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'controledeestoque',
    password: 'admin',
    port: 5432
});

module.exports = BD;