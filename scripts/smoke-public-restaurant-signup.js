const assert = require("node:assert/strict");

const Restaurante = require("../models/Restaurante");
const controller = require("../controllers/restauranteController");

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function run() {
  const originalFindOne = Restaurante.findOne;
  const originalCreate = Restaurante.create;

  try {
    let created = null;
    Restaurante.findOne = async () => null;
    Restaurante.create = async (payload) => {
      created = { id: "0123456789abcdef01234567", ...payload, sessaoVersao: 1 };
      return created;
    };

    const res = response();
    await controller.publicRegister({
      body: {
        nomeRestaurante: " Restaurante Sao Jose ",
        responsavel: "Maria Silva",
        email: " NOVO@EXEMPLO.COM ",
        telefone: "(81) 99999-9999",
        cidade: "Olinda/PE",
        segmento: "Restaurante",
        senha: "segredo123",
        plano: "full",
        status: "ativo",
      },
    }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.status, "aguardando_liberacao");
    assert.equal(res.body.token, undefined);
    assert.equal(res.body.restaurante.senha, undefined);
    assert.equal(created.email, "novo@exemplo.com");
    assert.equal(created.plano, "free");
    assert.equal(created.ativo, false);
    assert.equal(created.statusAssinatura, "bloqueado");
    assert.equal(created.enderecoCidade, "Olinda/PE");
    assert.notEqual(created.senha, "segredo123");
    assert.ok(created.dataFimPlano > created.dataInicioPlano);

    Restaurante.findOne = async ({ email }) => email ? created : null;
    const duplicateRes = response();
    await controller.publicRegister({
      body: {
        nomeRestaurante: "Outro Restaurante",
        responsavel: "Maria Silva",
        email: "novo@exemplo.com",
        telefone: "(81) 99999-9999",
        cidade: "Olinda/PE",
        senha: "segredo123",
      },
    }, duplicateRes);
    assert.equal(duplicateRes.statusCode, 409);

    console.log("OK: cadastro do site cria restaurante Free bloqueado e sem sessao.");
  } finally {
    Restaurante.findOne = originalFindOne;
    Restaurante.create = originalCreate;
  }
}

run().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
