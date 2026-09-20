const crypto=require('node:crypto');
const RequestLog=require('../models/PontoCertoIntegrationRequest');
const {bodyHash,verifySignature}=require('../services/pontoCertoSignature');

const header=(req,name)=>String(req.headers[String(name).toLowerCase()]||'').trim();
const mutation=(method)=>!['GET','HEAD','OPTIONS'].includes(String(method||'GET').toUpperCase());
module.exports=async function authPontoCerto(req,res,next){
  try{
    const client=header(req,'x-pc-client'),timestamp=header(req,'x-pc-timestamp'),nonce=header(req,'x-pc-nonce'),idempotencyKey=header(req,'x-pc-idempotency-key'),signature=header(req,'x-pc-signature');
    const expectedClient=String(process.env.PONTO_CERTO_BRIDGE_CLIENT_ID||'').trim(),secret=String(process.env.PONTO_CERTO_BRIDGE_SECRET||'');
    if(!expectedClient||!secret)return res.status(503).json({code:'PONTO_CERTO_BRIDGE_NOT_CONFIGURED',mensagem:'Integração Ponto Certo não configurada.'});
    if(!client||client!==expectedClient||!timestamp||!nonce||!signature)return res.status(401).json({code:'PONTO_CERTO_AUTH_REQUIRED',mensagem:'Autenticação Ponto Certo inválida.'});
    if(mutation(req.method)&&!idempotencyKey)return res.status(400).json({code:'IDEMPOTENCY_KEY_REQUIRED',mensagem:'X-PC-Idempotency-Key é obrigatório para alterações.'});
    const n=Number(timestamp),ts=Number.isFinite(n)?(n<1e12?n*1000:n):NaN;
    if(!Number.isFinite(ts)||Math.abs(Date.now()-ts)>300000)return res.status(401).json({code:'PONTO_CERTO_TIMESTAMP_EXPIRED',mensagem:'Timestamp da integração expirado.'});
    const path=String(req.originalUrl||req.url||'').split('?')[0],requestHash=bodyHash(req.body||{});
    if(!verifySignature({method:req.method,path,timestamp,nonce,body:req.body||{}},secret,signature))return res.status(401).json({code:'PONTO_CERTO_SIGNATURE_INVALID',mensagem:'Assinatura HMAC inválida.'});
    const nonceUsed=await RequestLog.findOne({nonce}).lean();if(nonceUsed)return res.status(401).json({code:'PONTO_CERTO_REPLAY',mensagem:'Nonce já utilizado.'});
    if(idempotencyKey){const previous=await RequestLog.findOne({idempotencyKey}).lean();if(previous){if(previous.requestHash!==requestHash||String(previous.method).toUpperCase()!==String(req.method).toUpperCase()||previous.path!==path)return res.status(409).json({code:'IDEMPOTENCY_CONFLICT',mensagem:'A chave de idempotência já foi usada com outro conteúdo.'});req.pcIntegrationRequest=previous;req.pcIdempotentReplay=Boolean(previous.responseStatus);return next();}}
    const record=await RequestLog.create({idempotencyKey:idempotencyKey||`read:${nonce}`,nonce,method:String(req.method).toUpperCase(),path,requestHash});
    req.pcIntegrationRequest=record;req.pcIdempotentReplay=false;return next();
  }catch(error){if(/Duplicate entry/i.test(String(error?.message||'')))return res.status(401).json({code:'PONTO_CERTO_REPLAY',mensagem:'Requisição já utilizada.'});console.error('authPontoCerto:',error);return res.status(500).json({code:'PONTO_CERTO_AUTH_ERROR',mensagem:'Falha ao autenticar integração.'});}
};
