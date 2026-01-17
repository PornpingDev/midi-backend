const express = require('express');
const router = express.Router();

const { createProduct,
        getAllProducts,
        getProductById,
        updateProduct,
        deleteProduct,
        cancelReserveStock,
        getByProductNo,
        getProductsForPO,
 } = require('../controllers/productsController');

router.post('/', createProduct);
router.get('/', getAllProducts);

router.get('/for-po', getProductsForPO);

router.get('/:id', getProductById);
router.put('/:id', updateProduct);
router.delete('/:id', deleteProduct);

router.post('/cancel-reserve', cancelReserveStock);
router.get("/by-no/:no", getByProductNo);

module.exports = router;
