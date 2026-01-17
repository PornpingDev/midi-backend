const express = require('express');
const router = express.Router();
const usersController = require('../controllers/usersController');



router.post('/', usersController.createUser);
router.get('/', usersController.getAllUsers);
router.put('/:id', usersController.updateUser);
router.delete('/:id', usersController.deleteUser);
router.get('/last-code', usersController.getLastEmployeeCode);
router.put('/:id/reset-password', usersController.resetPassword);

module.exports = router;
