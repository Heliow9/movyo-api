const express = require('express');
const router = express.Router();
const authPontoCerto = require('../middlewares/authPontoCerto');
const controller = require('../controllers/pontoCertoIntegrationController');

router.use(authPontoCerto);
router.get('/customers', controller.listCustomers);
router.get('/customers/:id/license', controller.getLicense);
router.get('/customers/:id', controller.getCustomer);
router.post('/customers', controller.createCustomer);
router.put('/customers/:id/subscription', controller.updateSubscription);
router.post('/customers/:id/block', controller.blockCustomer);
router.post('/customers/:id/unblock', controller.unblockCustomer);

module.exports = router;
