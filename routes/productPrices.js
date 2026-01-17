const express = require('express');
const router = express.Router();

const productPricesController =
require('../controllers/productPricesController');

router.post('/', productPricesController.createProductPrice);
router.get('/', productPricesController.getProductPrice);
router.put('/:id', productPricesController.updateProductPrice);
router.delete('/:id', productPricesController.deleteProductPrice);







module.exports = router;

    
