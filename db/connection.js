const mysql = require('mysql2/promise');
require('dotenv').config();

const isCloudSqlSocket = (process.env.DB_HOST || '').startsWith('/cloudsql/');

const pool = mysql.createPool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  // ✅ ถ้า DB_HOST เป็น /cloudsql/... ให้ใช้ socketPath
  ...(isCloudSqlSocket
    ? { socketPath: process.env.DB_HOST }
    : { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306) }),

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool;
