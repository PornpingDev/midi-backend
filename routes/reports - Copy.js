// MIDI-API/routes/reports.js
const express = require("express");
const router = express.Router();
const reportsController = require("../controllers/reportsController");

// ถ้าจะครอบสิทธิ์ภายหลัง ให้ใส่ middleware จาก middleware/authn.js, authz.js ที่นี่ได้
router.get("/stock-balance", reportsController.getStockBalance);
router.get("/delivery-progress", reportsController.getDeliveryProgress);
router.get("/monthly-sales-purchases", reportsController.getMonthlySalesPurchases); 
router.get('/product-sales', reportsController.getProductSales);
router.get('/product-nonmovement', reportsController.getProductNonMovement); 


module.exports = router;
