const express = require('express');
const app = express();
const cors = require('cors');
const cookieSession = require('cookie-session');



/* ===== HEALTH CHECK (ต้องอยู่บน ๆ) ===== */
app.get("/health", (req, res) => {
  res.status(200).send("ok");
});



/* ---------- Core Middlewares ---------- */
app.set('trust proxy', 1); // เผื่อรันหลัง proxy/HTTPS ในอนาคต



app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cors({
  origin: [process.env.FRONTEND_ORIGIN || 'http://localhost:5173'],
  credentials: true
}));

app.use(cookieSession({
  name: 'midi.sid',
  secret: process.env.SESSION_SECRET || 'midi-super-secret',
  httpOnly: true,
  sameSite: 'lax',   // โปรดักชันข้ามโดเมนให้ใช้ 'none' + secure:true
  secure: false,     // true เมื่อใช้ HTTPS จริง
  maxAge: 7 * 24 * 60 * 60 * 1000
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
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("✅ Server running on port", PORT);
});

