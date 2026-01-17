const express = require("express");
const router = express.Router();
const controller = require("../controllers/salesOrdersController");

router.post("/", controller.createSalesOrder);
router.get("/", controller.getAllSalesOrders);
router.get("/:id/items", controller.getSalesOrderItems);
router.get("/:id/items-summary", controller.getItemsSummary);
router.delete("/:id", controller.deleteSalesOrder);
router.post("/:id/items", controller.addSalesOrderItem);
router.put("/:soId/items/:productId/soft-delete", controller.softDeleteOrderItemByProduct);
router.get('/:id/for-delivery', controller.getForDeliveryPreview);



module.exports = router;
