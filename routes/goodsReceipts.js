// routes/goodsReceipts.js
const express = require("express");
const router = express.Router();
const controller = require("../controllers/goodsReceiptsController");

// รับของตาม PO ทันที (สร้าง GR + ตัด stock)
router.post("/receive-now", controller.receiveNow);

// ดึงประวัติรับของทั้งหมดของ PO ใบหนึ่ง (รูปแบบ 1)
router.get("/by-po/:id", controller.getHistoryByPurchaseOrder);

// ดึงรายละเอียด GR ใบเดียว
router.get("/:id", controller.getGoodsReceiptById);

module.exports = router;
