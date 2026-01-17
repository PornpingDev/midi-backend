const mysql = require("mysql2/promise");
require("dotenv").config();

/**
 * รองรับ 2 โหมด:
 * 1) Cloud Run + Cloud SQL Socket
 *    DB_HOST=/cloudsql/PROJECT:REGION:INSTANCE
 *
 * 2) Public IP / Local
 *    DB_HOST=xx.xx.xx.xx
 */

const isCloudSqlSocket =
  process.env.DB_HOST && process.env.DB_HOST.startsWith("/cloudsql/");

const poolConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

// 🔑 เลือกวิธี connect ตาม DB_HOST
if (isCloudSqlSocket) {
  // Cloud Run → Cloud SQL (Socket)
  poolConfig.socketPath = process.env.DB_HOST;
  console.log("✅ Using Cloud SQL socket:", process.env.DB_HOST);
} else {
  // Public IP / Local / Workbench
  poolConfig.host = process.env.DB_HOST;
  poolConfig.port = Number(process.env.DB_PORT || 3306);
  console.log("✅ Using MySQL host:", process.env.DB_HOST);
}

const pool = mysql.createPool(poolConfig);

module.exports = pool;
