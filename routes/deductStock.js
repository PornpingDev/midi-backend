const express = require('express');
const router = express.Router();
const { deductStock } = require('../controllers/deductStockController');

// POST /deduct-stock
router.post('/', deductStock);

module.exports = router;
