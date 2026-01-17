const express = require("express");
const router = express.Router();
const bomController = require("../controllers/bomController");

router.get("/", bomController.getAllBOMs);
router.get("/:id", bomController.getBOMById); 
router.post("/", bomController.createBOM);
router.put("/:id", bomController.updateBOM);
router.delete("/:id", bomController.deleteBOM);
router.post("/full", bomController.createFullBOM);
router.put("/full/:id", bomController.updateBOMWithComponents);


router.get("/:id/buildability", bomController.getBuildability);     
router.get("/:id/preview",      bomController.previewBuild);        
router.post("/:id/reserve",     bomController.reserveForBOM);       
router.post("/:id/produce",     bomController.produceFromBOM);      
router.post("/:id/cancel-reserve", bomController.cancelReserveForBOM); 




module.exports = router;
