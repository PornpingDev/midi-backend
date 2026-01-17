const express = require("express");
const router = express.Router();
const productSuppliersController = require("../controllers/productSuppliersController");

router.post("/", productSuppliersController.createProductSupplier);
router.get("/", productSuppliersController.getProductSuppliers);
router.put("/:id", productSuppliersController.updateProductSupplier);
router.delete("/:id", productSuppliersController.deleteProductSupplier);


module.exports = router;
