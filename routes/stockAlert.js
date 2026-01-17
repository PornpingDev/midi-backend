const express = require('express');
const router = express.Router();
const { getStockAlerts } = require('../controllers/stockAlertController');

router.get('/', getStockAlerts);

module.exports = router;
