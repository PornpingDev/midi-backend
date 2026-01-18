const express = require('express');
const app = express();
const cors = require('cors');
const cookieSession = require('cookie-session');

/* ===== HEALTH CHECK (ต้องอยู่บน ๆ) ===== */
app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

/* ---------- Core Middlewares ---------- */
app.set('trust proxy', 1); // จำเป็นเวลาอยู่หลัง proxy/https (Cloud Run)

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------- CORS (รองรับ localhost + Firebase Hosting) ---------- */
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',

  // Firebase Hosting
  'https://midi-stock-management.web.app',
  'https://midi-stock-management.firebaseapp.com',
];

// ถ้าพี่อยาก override ด้วย env ก็ได้ (ใส่เพิ่มเข้า list)
if (process.env.FRONTEND_ORIGIN) {
  allowedOrigins.push(process.env.FRONTEND_ORIGIN);
}

const corsOptions = {
  origin: function (origin, callback) {
    // อนุญาต request ที่ไม่มี origin (เช่น Postman/curl/health check)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS: ' + origin), false);
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // รองรับ preflight

/* ---------- Session Cookie (ข้ามโดเมนใน production) ---------- */
const isProd = process.env.NODE_ENV === 'production';

app.use(cookieSession({
  name: 'midi.sid',
  secret: process.env.SESSION_SECRET || 'midi-super-secret',
  httpOnly: true,

  // 🔥 สำคัญ: prod (web.app -> run.app) ต้อง none + secure
  sameSite: isProd ? 'none' : 'lax',
  secure: isProd, // prod = true (https), dev = false (http)

  maxAge: 7 * 24 * 60 * 60 * 1000,
}));

/* ---------- Routes ---------- */
const productsRoutes = require('./routes/products');
const deductStockRoutes = require('./routes/deductStock');
const stockAlertRoutes = require('./routes/stockAlert');
const reserveRoutes = require("./routes/reserve");
const salesOrdersRoutes = require("./routes/salesOrders");
const usersRoutes = require('./routes/users');
const authRoutes = require('./routes/auth');
const customerRoutes = require('./routes/customers');
const supplierRoutes = require("./routes/suppliers");
const productPricesRoutes = require('./routes/productPrices');
const productFilesRoutes = require("./routes/productFiles");
const productSuppliersRoutes = require("./routes/productSuppliers");
const bomsRoutes = require("./routes/boms");
const bomComponentsRoutes = require("./routes/bomComponents");
const deliveryNotesRoutes = require('./routes/deliveryNotes');
const documentsRoutes = require('./routes/documents');
const manualDocuments = require('./routes/manualDocuments');
const purchaseOrdersRoutes = require("./routes/purchaseOrders");
const goodsReceiptsRoutes = require("./routes/goodsReceipts");

/* ✅ จุดต่อใหม่สำหรับเปลี่ยนรหัสผ่าน */
app.use(require('./routes/me'));

app.use('/deduct-stock', deductStockRoutes);
app.use('/products', productsRoutes);
app.use('/stock-alert', stockAlertRoutes);
app.use("/api/reservations", reserveRoutes);
app.use("/sales-orders", salesOrdersRoutes);
app.use('/users', usersRoutes);
app.use('/auth', authRoutes);
app.use('/customers', customerRoutes);
app.use("/suppliers", supplierRoutes);
app.use('/product-prices', productPricesRoutes);
app.use("/api", productFilesRoutes);
app.use("/api/product-suppliers", productSuppliersRoutes);
app.use("/boms", bomsRoutes);
app.use("/bom-components", bomComponentsRoutes);
app.use('/api', deliveryNotesRoutes);
app.use('/api', documentsRoutes);
app.use('/api', manualDocuments);
app.use("/api/reports", require("./routes/reports"));
app.use("/purchase-orders", purchaseOrdersRoutes);
app.use("/goods-receipts", goodsReceiptsRoutes);

/* 404 */
app.use((req, res) => res.status(404).json({ message: 'Not found' }));

/* Error handler (ต้องอยู่ก่อน listen) */
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ message: err.message || 'Internal Server Error' });
});

/* Listen */
const PORT = process.env.PORT;

if (!PORT) {
  console.error("❌ PORT is not defined");
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

