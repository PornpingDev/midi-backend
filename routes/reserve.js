const express = require("express");
const router = express.Router();
const reserveController = require("../controllers/reserveController");

//  จอง stock ตามรายการ (sales_order_id + items)
router.post("/reserve-stock", reserveController.reserveStock);

// ใหม่: จองทีละรายการ
router.post("/reserve-item", reserveController.reserveItem);

// ใหม่: แก้ไขจำนวนที่จอง
router.put("/reserve-item/:id", reserveController.updateReservation);

// ใหม่: ยกเลิกจอง (soft delete)
router.patch("/reserve-item/:id/cancel", reserveController.cancelReservation);

// ใหม่: ดึงรายการจองตาม SO
router.get("/reservations/:sales_order_id", reserveController.getReservationsBySalesOrderId);

module.exports = router;
