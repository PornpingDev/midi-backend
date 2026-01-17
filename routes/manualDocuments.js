// routes/manualRoutes.js
const express = require('express');
const router = express.Router();
const manual = require('../controllers/manualController');


const { authenticate } = require('../middleware/authn');


// โปรเจกต์นักศึกษา: ให้สิทธิ์ตามที่คุยไว้ (พื้นฐาน)
router.post('/manual', authenticate,  manual.createDraft);
router.get('/manual/list', authenticate,  manual.listManual);
router.get('/manual/:id', authenticate,  manual.getManual);
router.put('/manual/:id', authenticate,  manual.updateManualHeader);
router.put('/manual/:id/items', authenticate,  manual.replaceItems);
router.post('/manual/:id/approve', authenticate,  manual.approveManual);
router.post('/manual/:id/duplicate', authenticate,  manual.duplicateManual);
router.post('/manual/:id/void', authenticate,  manual.voidManual);
router.get('/manual/:id/print', authenticate, manual.manualPrint); 


module.exports = router;
