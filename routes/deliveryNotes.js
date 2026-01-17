const express = require('express');
const router = express.Router();
const controller = require('../controllers/deliveryNotesController');
const { authenticate } = require('../middleware/authn');


router.post('/delivery-notes/send-now',
  authenticate,
  controller.sendNow
);

module.exports = router;
