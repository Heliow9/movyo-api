// routes/bot.js
const express = require('express');
const router = express.Router();
const botController = require('../controllers/botController');
const { enviarMensagem2 } = require('../utils/bot');

// Iniciar Bot
router.post('/start', botController.startBot);

// Verificar Status do Bot
router.get('/status/:restauranteId', botController.getStatus);

// Obter QR Code do Bot
router.get('/qr/:restauranteId', botController.getQrCode);

// Parar Bot
router.delete('/stop/:restauranteId', botController.stopBot);

// Resetar Sessão do Bot
router.post('/reset/:restauranteId', botController.resetSession);

router.get('/teste-msg', async (req, res) => {
  try {
    console.log('Iniciando teste de mensagem');
    await enviarMensagem2('67f07aa3cc3cc5b6e0ebd503', '5581994262615', 'Mensagem de teste');
    res.send('Mensagem enviada com sucesso');
  } catch (err) {
    console.error('Erro ao enviar mensagem:', err.message);
    res.status(500).send('Erro ao enviar: ' + err.message);
  }
});


module.exports = router;
