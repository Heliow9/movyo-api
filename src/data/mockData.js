export const PLANOS_OFICIAIS = [
  { codigo:'free', nome:'Free', valorMensal:0, descricao:'Plano gratuito inicial para novos restaurantes.', recursos:['Cadastro inicial','Teste controlado','Recursos limitados'] },
  { codigo:'starter-mobile', nome:'Start Mobile', valorMensal:69.90, descricao:'Ideal para quem gerencia tudo pelo celular.', recursos:['Gestão completa pelo celular','Dashboard Mobile','Produtos e categorias','Mesas e comandas','Caixa e balcão','Até 2 garçons'] },
  { codigo:'essencial', nome:'Essencial', valorMensal:129.90, descricao:'Para profissionalizar a operação com mais controle.', recursos:['Tudo do Start Mobile','Sistema Desktop','Controle de caixa','Impressão automática','Relatórios avançados','Até 3 acessos'] },
  { codigo:'professional', nome:'Professional', valorMensal:199.90, descricao:'Controle completo do restaurante, garçons e entregas.', recursos:['Tudo do Essencial','App Garçom completo','App Motorista/Entregador','Gestão de entregadores','Rastreamento por link','Cozinha integrada'] },
  { codigo:'premium', nome:'Premium', valorMensal:299.90, descricao:'A plataforma completa com todas as funcionalidades.', recursos:['Tudo do Professional','Dashboard executivo','Relatórios corporativos','Gestão multiusuários','Prioridade máxima','Funcionalidades futuras'] },
  { codigo:'full', nome:'Full SaaS Admin', valorMensal:0, descricao:'Exclusivo para administração interna da Movyo.', recursos:['Sem limitações','Admin SaaS','Demonstrações','Homologação','Suporte interno'] }
];

export const restaurantesDemo = [
  { id:'1', nome:'Pizzaria Movyo 2026', email:'pizzaria@movyo.delivery', slugIdentificador:'pizzaria-movyo-2026', telefone:'81999999999', plano:'starter-mobile', statusAssinatura:'ativo', dataInicioPlano:'2026-06-10', dataFimPlano:'2026-07-10', ativo:true, enderecoCidade:'Olinda', enderecoBairro:'Centro' },
  { id:'2', nome:'Jr Lanches', email:'jr@movyo.delivery', slugIdentificador:'jr-lanches', telefone:'81988887777', plano:'essencial', statusAssinatura:'teste', dataInicioPlano:'2026-06-10', dataFimPlano:'2026-06-17', ativo:true, enderecoCidade:'Recife', enderecoBairro:'Boa Vista' }
];
