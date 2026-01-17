// routes/purchaseOrders.js
const express = require("express");
const router = express.Router();
const controller = require("../controllers/purchaseOrdersController");

const goodsReceiptsController = require("../controllers/goodsReceiptsController");
const { createAutoPOFromStock } = require("../controllers/purchaseOrdersController");



router.post("/auto-one", controller.createAutoPOFromStock);

router.post("/", controller.createPurchaseOrder);
router.get("/", controller.getAllPurchaseOrders);

router.get("/:id/for-receive", controller.getForReceivePreview);
router.get("/:id/receive-history", goodsReceiptsController.getHistoryByPurchaseOrder);
router.post("/:id/approve", controller.approvePurchaseOrder);
router.post("/:id/items", controller.addPurchaseOrderItem);
router.delete("/:id/items/:itemId", controller.deletePurchaseOrderItem);

router.get("/:id/print-payload", controller.getPOPrintPayload);

router.get("/:id", controller.getPurchaseOrderById);
router.delete("/:id", controller.deletePurchaseOrder);






module.exports = router;
