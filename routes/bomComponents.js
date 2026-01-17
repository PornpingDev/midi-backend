const express = require("express");
const router = express.Router();
const bomComponentController = require("../controllers/bomComponentController");

router.get("/", bomComponentController.getComponentsByBOMId); // ✅ รับ ?bom_id=...
router.post("/", bomComponentController.addBOMComponent);
router.put("/:id", bomComponentController.updateBOMComponent);
router.delete("/:id", bomComponentController.deleteBOMComponent);
router.post("/bulk", bomComponentController.addMultipleComponents);

module.exports = router;
