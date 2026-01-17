const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authn');
const { changeMyPassword } = require('../controllers/meController');

router.post('/me/change-password', authenticate, changeMyPassword);

module.exports = router;
