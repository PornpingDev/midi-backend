// routes/documents.js
const express = require('express');
const router = express.Router();
const documentsController = require('../controllers/documentsController');
const { authenticate } = require('../middleware/authn');


// List / Detail / Print: admin + sales
router.get('/documents/pairs',           authenticate, documentsController.listPairs);
router.get('/documents/pairs/:id',       authenticate, documentsController.getPairDetail);
router.get('/documents/pairs/:id/print', authenticate, documentsController.printPair);

// Reprint: admin + sales
router.post('/documents/pairs/:id/reprint', authenticate, documentsController.reprintPair);

// Void: admin only
router.post('/documents/pairs/:id/void',    authenticate, documentsController.voidPair);



module.exports = router;
