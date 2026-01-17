const express = require("express");
const multer = require("multer");
const {
  uploadProductFiles,
  deleteProductFile,
  getProductFiles,
} = require("../controllers/productFilesController");

const router = express.Router();
const upload = multer(); // ใช้ memory storage (เหมาะกับอัปโหลดไป GCS)

router.post(
  "/products/:product_no/files",
  upload.array("files", 10), // รองรับอัปโหลดหลายไฟล์
  uploadProductFiles
);

router.get("/products/:product_no/files", getProductFiles);

router.delete("/product-files/:id", deleteProductFile);

module.exports = router;
