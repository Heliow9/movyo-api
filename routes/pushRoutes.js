const express = require('express');
const authRestaurante = require('../middlewares/authRestaurante');
const {
  getPublicKey,
  isConfigured,
  saveSubscription,
  saveNativeSubscription,
  removeSubscription,
  removeNativeSubscription,
  sendToRestaurant,
  getRestaurantStatus,
} = require('../services/webPushService');

const router = express.Router();

router.get('/public-key', (req, res) => {
  const publicKey = getPublicKey();
  if (!publicKey || !isConfigured()) {
    return res.status(503).json({
      ok: false,
      code: 'WEB_PUSH_NOT_CONFIGURED',
      message: 'Web Push ainda não foi configurado na API.',
    });
  }
  return res.json({ ok: true, publicKey });
});

router.use(authRestaurante);

router.post('/subscribe', async (req, res) => {
  try {
    const tokenRestauranteId = String(req.restauranteId || '');
    const bodyRestauranteId = req.body?.restauranteId ? String(req.body.restauranteId) : tokenRestauranteId;
    if (!tokenRestauranteId || bodyRestauranteId !== tokenRestauranteId) {
      return res.status(403).json({
        ok: false,
        code: 'RESTAURANTE_MISMATCH',
        message: 'A inscrição não pertence ao restaurante autenticado.',
      });
    }

    const doc = await saveSubscription({
      restauranteId: tokenRestauranteId,
      usuarioId: req.userId || req.user?._id || req.user?.id,
      role: req.role || req.user?.role,
      subscription: req.body?.subscription,
      plataforma: req.body?.plataforma,
      standalone: req.body?.standalone,
      userAgent: req.body?.userAgent || req.headers['user-agent'],
    });

    return res.status(201).json({
      ok: true,
      subscriptionId: doc._id,
      restauranteId: doc.restauranteId,
      plataforma: doc.plataforma,
      ativo: doc.ativo,
      syncedAt: doc.ultimaSincronizacaoEm,
    });
  } catch (error) {
    console.error('Erro ao salvar inscrição Web Push:', error?.message || error);
    return res.status(error?.status || 500).json({
      ok: false,
      code: 'PUSH_SUBSCRIPTION_SAVE_FAILED',
      message: error?.message || 'Erro ao salvar inscrição Web Push.',
    });
  }
});

router.post('/subscribe/native', async (req, res) => {
  try {
    const tokenRestauranteId = String(req.restauranteId || '');
    const bodyRestauranteId = req.body?.restauranteId ? String(req.body.restauranteId) : tokenRestauranteId;
    if (!tokenRestauranteId || bodyRestauranteId !== tokenRestauranteId) {
      return res.status(403).json({
        ok: false,
        code: 'RESTAURANTE_MISMATCH',
        message: 'O token push nao pertence ao restaurante autenticado.',
      });
    }

    const doc = await saveNativeSubscription({
      restauranteId: tokenRestauranteId,
      usuarioId: req.userId || req.user?._id || req.user?.id,
      role: req.role || req.user?.role,
      pushToken: req.body?.pushToken || req.body?.expoPushToken,
      plataforma: req.body?.plataforma,
      deviceId: req.body?.deviceId,
      userAgent: req.body?.userAgent || req.headers['user-agent'],
    });

    return res.status(201).json({
      ok: true,
      subscriptionId: doc._id,
      restauranteId: doc.restauranteId,
      plataforma: doc.plataforma,
      provider: doc.pushProvider,
      ativo: doc.ativo,
      syncedAt: doc.ultimaSincronizacaoEm,
    });
  } catch (error) {
    console.error('Erro ao salvar token push nativo:', error?.message || error);
    return res.status(error?.status || 500).json({
      ok: false,
      code: error?.code || 'NATIVE_PUSH_SUBSCRIPTION_SAVE_FAILED',
      message: error?.message || 'Erro ao salvar token push nativo.',
    });
  }
});

router.delete('/subscribe', async (req, res) => {
  try {
    const endpoint = req.body?.endpoint || req.body?.subscription?.endpoint;
    if (!endpoint) return res.status(400).json({ ok: false, message: 'endpoint é obrigatório.' });
    const removed = await removeSubscription({ restauranteId: req.restauranteId, endpoint });
    return res.json({ ok: true, removed });
  } catch (error) {
    return res.status(error?.status || 500).json({ ok: false, message: error?.message || 'Erro ao remover inscrição push.' });
  }
});

router.delete('/subscribe/native', async (req, res) => {
  try {
    const pushToken = req.body?.pushToken || req.body?.expoPushToken;
    if (!pushToken) return res.status(400).json({ ok: false, message: 'pushToken e obrigatorio.' });
    const removed = await removeNativeSubscription({
      restauranteId: req.restauranteId,
      pushToken,
    });
    return res.json({ ok: true, removed });
  } catch (error) {
    return res.status(error?.status || 500).json({
      ok: false,
      code: error?.code,
      message: error?.message || 'Erro ao remover token push nativo.',
    });
  }
});

router.get('/status', async (req, res) => {
  try {
    const status = await getRestaurantStatus(req.restauranteId);
    return res.json({ ok: true, ...status });
  } catch (error) {
    return res.status(500).json({ ok: false, message: 'Erro ao consultar Web Push.', error: error?.message });
  }
});

router.post('/test', async (req, res) => {
  try {
    if (String(req.role || '').toLowerCase() === 'garcom') {
      return res.status(403).json({ ok: false, code: 'PUSH_TEST_FORBIDDEN', message: 'Use o acesso do restaurante para testar o Web Push.' });
    }
    const body = String(req.body?.body || 'O Web Push do Movyo Hub está funcionando, inclusive em segundo plano.').slice(0, 180);
    const result = await sendToRestaurant(req.restauranteId, {
      title: 'Teste de notificação Movyo',
      body,
      tag: `movyo-push-test-${Date.now()}`,
      renotify: true,
      status: 'teste',
      data: { url: '/', screen: 'Home', status: 'teste' },
    }, { ttl: 60, urgency: 'high' });

    return res.status(result.reason === 'VAPID_NAO_CONFIGURADO' ? 503 : 200).json({ ok: result.ok, result });
  } catch (error) {
    console.error('Erro no teste Web Push:', error?.message || error);
    return res.status(500).json({ ok: false, message: 'Erro ao enviar teste Web Push.', error: error?.message });
  }
});

module.exports = router;
