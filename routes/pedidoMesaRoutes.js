const express = require('express');
const router = express.Router();
const PedidoMesa = require('../models/pedidoMesaModel');
const Mesa = require('../models/mesaModel');
const Pedido = require('../models/Pedido'); // IMPORTANTE: Precisamos do seu model de Pedido real

// --- Endpoint 1: Adicionar Item (com lógica de agrupamento) ---
router.post('/mesa/:mesaId/item', async (req, res) => {
    try {
        const { mesaId } = req.params;
        const itemData = req.body;

        const mesa = await Mesa.findById(mesaId);
        if (!mesa) {
            return res.status(404).json({ message: 'Mesa não encontrada.' });
        }

        let pedido = await PedidoMesa.findOne({ mesaId: mesaId, status: 'aberto' });

        if (!pedido) {
            // Se não existir carrinho, cria um novo
            pedido = new PedidoMesa({
                mesaId: mesaId,
                mesaNumero: mesa.numero,
                restauranteId: mesa.restauranteId,
                itens: [itemData]
            });
        } else {
            // CORREÇÃO 1: Lógica para agrupar itens idênticos
            // Compara o ID do produto e as customizações para ver se são iguais
            const itemExistenteIndex = pedido.itens.findIndex(item => 
                item.produtoId.toString() === itemData.produtoId &&
                JSON.stringify(item.sabores) === JSON.stringify(itemData.sabores) &&
                JSON.stringify(item.borda) === JSON.stringify(itemData.borda) &&
                JSON.stringify(item.adicional) === JSON.stringify(itemData.adicional) &&
                JSON.stringify(item.complementos) === JSON.stringify(itemData.complementos) &&
                JSON.stringify(item.extras) === JSON.stringify(itemData.extras) &&
                item.observacoes === itemData.observacoes
            );

            if (itemExistenteIndex > -1) {
                // Se o item já existe, apenas soma a quantidade
                pedido.itens[itemExistenteIndex].quantidade += itemData.quantidade;
            } else {
                // Se for um item novo, adiciona ao carrinho
                pedido.itens.push(itemData);
            }
        }

        pedido.recalcularTotal();
        await pedido.save();
        res.status(200).json(pedido);

    } catch (error) {
        console.error("Erro ao adicionar item ao pedido:", error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

// --- Endpoint 2: Obter o Carrinho/Pedido da Mesa (sem grandes mudanças) ---
router.get('/mesa/:mesaId/carrinho', async (req, res) => {
    try {
        const { mesaId } = req.params;
        const pedido = await PedidoMesa.findOne({ mesaId: mesaId, status: 'aberto' })
            .populate('restauranteId', 'nome')
            .populate('mesaId', 'numero');

        if (!pedido) {
            const mesa = await Mesa.findById(mesaId);
            return res.status(200).json({ 
                itens: [], 
                valorTotal: 0, 
                mesa: mesa 
            });
        }
        res.status(200).json(pedido);
    } catch (error) {
        console.error("Erro ao buscar carrinho:", error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

// --- Endpoint 3: Finalizar o Pedido (Corrigido para criar um Pedido REAL) ---
router.post('/mesa/:mesaId/finalizar', async (req, res) => {
    try {
        const { mesaId } = req.params;
        // 1. Encontra o carrinho aberto
        const carrinho = await PedidoMesa.findOne({ mesaId: mesaId, status: 'aberto' });

        if (!carrinho || carrinho.itens.length === 0) {
            return res.status(404).json({ message: 'Nenhum carrinho aberto ou itens encontrados para finalizar.' });
        }
        
        // 2. CORREÇÃO 2: Cria um novo Pedido REAL a partir dos dados do carrinho
        //    Usamos o seu model 'Pedido' original, para que ele apareça na sua cozinha
        const novoPedido = new Pedido({
            restaurante: carrinho.restauranteId,
            mesaId: carrinho.mesaId,
            nomeCliente: `Mesa ${carrinho.mesaNumero}`,
            itens: carrinho.itens,
            valorTotal: carrinho.valorTotal,
            origem: 'salao',
            status: 'em_producao', // Já entra em produção!
            // Adicione outros campos que seu Pedido precisa
        });

        await novoPedido.save();

        // 3. Notifica a cozinha em tempo real com o NOVO PEDIDO, como seu sistema já espera
        if (req.io) {
            req.io.to(`restaurante-${carrinho.restauranteId}`).emit('novoPedido', novoPedido);
        }

        // 4. Limpa o carrinho: agora que virou um pedido, o carrinho pode ser removido
        await PedidoMesa.findByIdAndDelete(carrinho._id);
        
        res.status(201).json({ message: 'Pedido enviado para a cozinha com sucesso!', pedido: novoPedido });

    } catch (error) {
        console.error("Erro ao finalizar pedido:", error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

module.exports = router;