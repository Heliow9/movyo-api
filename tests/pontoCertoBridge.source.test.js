const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const defs=fs.readFileSync('models/_defs.js','utf8');
const auth=()=>fs.readFileSync('middlewares/authPontoCerto.js','utf8');
const signature=()=>fs.readFileSync('services/pontoCertoSignature.js','utf8');
const route=()=>fs.readFileSync('routes/pontoCertoInternalRoutes.js','utf8');
const billing=()=>fs.readFileSync('services/saasBillingService.js','utf8');
const restAuth=()=>fs.readFileSync('middlewares/authRestaurante.js','utf8');
const accessPolicy=()=>fs.readFileSync('utils/restaurantAccessPolicy.js','utf8');
test('restaurant stores separate Ponto Certo billing mirror',()=>{assert.match(defs,/billingSource/);assert.match(defs,/billingAccessBlocked/);assert.match(defs,/pontoCertoSubscriptionId/);assert.match(defs,/billingCurrentPeriodEnd/);assert.match(defs,/billingDigitableLine/);assert.match(defs,/bloqueado:bool/);});
test('bridge auth uses HMAC timestamp nonce and idempotency',()=>{const s=auth();assert.match(s,/X-PC-Client|x-pc-client/i);assert.match(s,/timestamp/i);assert.match(s,/nonce/i);assert.match(s,/idempotency/i);assert.match(signature(),/timingSafeEqual/);});
test('internal API has customer sync block and license routes',()=>{const s=route();assert.match(s,/customers/);assert.match(s,/subscription/);assert.match(s,/block/);assert.match(s,/unblock/);assert.match(s,/license/);});
test('legacy monthly pix is forbidden after cutover',()=>{const s=billing();assert.match(s,/BILLING_MANAGED_BY_PONTO_CERTO/);assert.match(s,/billingSource/);});
test('financial billing block is separate from operational ativo',()=>{const middleware=restAuth(),policy=accessPolicy();assert.match(middleware,/getRestaurantAccessDecision/);assert.match(policy,/billingAccessBlocked/);assert.match(policy,/LICENCA_FINANCEIRA_BLOQUEADA/);});

test('legacy Movyo expiry worker skips Ponto Certo managed restaurants',()=>{const s=fs.readFileSync('controllers/saasController.js','utf8');assert.match(s,/billingSource[\s\S]*PONTO_CERTO/);assert.match(s,/<>\s*'PONTO_CERTO'/);});
test('bridge heals old automatic legacy block on ACTIVE or GRACE sync',()=>{const s=fs.readFileSync('controllers/pontoCertoIntegrationController.js','utf8');assert.match(s,/applyLegacyAutoBlockRepair/);assert.match(s,/ativo\s*=\s*true/);assert.match(s,/statusAssinatura\s*=\s*'ativo'/);});
