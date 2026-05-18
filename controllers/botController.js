const {
  iniciarBot,
  getInstancia,
  getQr,
  enviarMensagem,
  pararBot,
  estaConectado,
  getEstadoBot,
  liberarBot,
} = require('../utils/bot');
const Restaurante = require('../models/Restaurante');
const path = require('path');
const fs = require('fs');

// Iniciar bot com persistência
exports.startBot = async (req, res) => {
  const { restauranteId } = req.body;

  try {
    // Primeiro salva como ligado
    await Restaurante.findByIdAndUpdate(restauranteId, {
      $set: {
        'statusBot.ligado': true,
        'statusBot.atualizadoEm': new Date(),
      },
    });

    liberarBot(restauranteId); // desbloqueia da blacklist manual
    await iniciarBot(restauranteId); // agora pode iniciar ✅

    res.json({ status: 'Bot iniciado com sucesso' });
  } catch (err) {
    console.error('Erro ao iniciar bot:', err);
    res.status(500).json({ erro: 'Erro ao iniciar bot' });
  }
};


// Parar bot e marcar como desligado
exports.stopBot = async (req, res) => {
  const { restauranteId } = req.params;
  try {
    await pararBot(restauranteId);

    // A função pararBot já atualiza o status no banco. Esta chamada é redundante,
    // mas a manteremos por segurança para garantir o estado.
    await Restaurante.findByIdAndUpdate(restauranteId, {
      $set: {
        'statusBot.ligado': false,
        'statusBot.conectado': false,
        'statusBot.atualizadoEm': new Date(),
      },
    });

    res.json({ status: 'Bot parado com sucesso' });
  } catch (err) {
    console.error('Erro ao parar bot:', err);
    res.status(500).json({ erro: 'Erro ao parar bot' });
  }
};

// ====================================================================
// Ver status de conexão - FUNÇÃO CORRIGIDA
// ====================================================================
exports.getStatus = async (req, res) => {
  const { restauranteId } = req.params;

  try {
    // Passo 1: Sempre buscar o estado salvo no banco (a intenção do usuário)
    // Usar .lean() é mais rápido para operações de apenas leitura.
    const restaurante = await Restaurante.findById(restauranteId);

    // Se não houver restaurante, o bot não pode estar ligado nem conectado.
    if (!restaurante) {
      return res.json({ ligado: false, conectado: false });
    }

    // Passo 2: Verificar o estado REAL da conexão na memória.
    // Esta é a única fonte confiável para saber se o bot está online AGORA.
    const conectadoNaMemoria = estaConectado(restauranteId);
    const estado = getEstadoBot(restauranteId);

    // Passo 3: Retornar a combinação correta e COMPLETA das informações.
    return res.json({
      ligado: (typeof restaurante.statusBot === 'string' ? (() => { try { return JSON.parse(restaurante.statusBot)?.ligado !== false } catch { return true } })() : restaurante.statusBot?.ligado !== false), // A intenção vem do banco.
      conectado: conectadoNaMemoria,                   // O status "real" (chip) vem da memória.
      estado: estado.estado,
      temQr: estado.temQr,
      tentativas: estado.tentativas,
      erroConexao: restaurante.statusBot?.erroConexao || null,
      atualizadoEm: restaurante.statusBot?.atualizadoEm || null,
    });

  } catch (error) {
    console.error('Erro ao buscar status:', error);
    return res.status(500).json({ erro: 'Erro ao verificar status', detalhe: error.message });
  }
};
// ====================================================================


// Obter QR code sem gerar 404 durante conexão.
// No front o QR é consultado em polling; 404 polui logs e faz a tela entender como erro.
exports.getQrCode = async (req, res) => {
  const { restauranteId } = req.params;

  try {
    const qrAtual = getQr(restauranteId);
    if (qrAtual) return res.json({ ok: true, qr: qrAtual, connecting: false });

    const restaurante = await Restaurante.findById(restauranteId);
    if (!restaurante) {
      return res.status(404).json({ ok: false, qr: null, erro: 'Restaurante não encontrado' });
    }

    // Garante que a intenção no banco esteja ligada e dispara o boot se ainda não houver socket.
    await Restaurante.findByIdAndUpdate(restauranteId, {
      $set: {
        'statusBot.ligado': true,
        'statusBot.conectado': false,
        'statusBot.atualizadoEm': new Date(),
      },
    });

    liberarBot(restauranteId);

    const estado = getEstadoBot(restauranteId);
    if (!estado.temInstancia && estado.estado !== 'connecting') {
      iniciarBot(restauranteId).catch((err) => {
        console.error('Erro ao iniciar bot via rota QR:', err?.message || err);
      });
    }

    // Pequena espera para capturar QR recém-gerado sem segurar a rota por segundos.
    await new Promise((resolve) => setTimeout(resolve, 120));
    const qrDepois = getQr(restauranteId);

    return res.json({
      ok: true,
      qr: qrDepois || null,
      connecting: !qrDepois,
      estado: getEstadoBot(restauranteId),
      mensagem: qrDepois ? 'QR disponível' : 'Bot iniciando/aguardando QR',
    });
  } catch (err) {
    console.error('Erro ao buscar QR:', err);
    return res.status(500).json({ ok: false, qr: null, erro: err?.message || 'Erro ao buscar QR' });
  }
};

// Enviar mensagem manual
exports.sendMessage = async (req, res) => {
  const { restauranteId, numero, mensagem } = req.body;
  try {
    await enviarMensagem(restauranteId, numero, mensagem);
    res.json({ status: 'Mensagem enviada' });
  } catch (err) {
    console.error('Erro ao enviar mensagem:', err);
    res.status(500).json({ erro: 'Erro ao enviar mensagem' });
  }
};

// Resetar sessão (apaga diretório da sessão)
exports.resetSession = async (req, res) => {
  const { restauranteId } = req.params;
  const pastaSessao = path.resolve(__dirname, `../sessions/session-${restauranteId}`);

  try {
    try {
      await pararBot(restauranteId);
    } catch (_) {}

    if (fs.existsSync(pastaSessao)) {
      fs.rmSync(pastaSessao, { recursive: true, force: true });
    }

    liberarBot(restauranteId);

    await Restaurante.findByIdAndUpdate(restauranteId, {
      $set: {
        'statusBot.ligado': false,
        'statusBot.conectado': false,
        'statusBot.ultimoQr': null,
        'statusBot.erroConexao': null,
        'statusBot.atualizadoEm': new Date(),
      },
    });

    res.json({ status: 'Sessão resetada. Você pode iniciar novamente.' });
  } catch (err) {
    console.error('Erro ao resetar sessão:', err);
    res.status(500).json({ erro: 'Erro ao resetar sessão' });
  }
};