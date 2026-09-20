const crypto=require('node:crypto');
function stable(value){
  if(value===null||value===undefined)return value===undefined?null:value;
  if(Array.isArray(value))return value.map(stable);
  if(typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  return value;
}
function stableJson(value){return JSON.stringify(stable(value??{}));}
function sha256(value){return crypto.createHash('sha256').update(String(value)).digest('hex');}
function bodyHash(body){return sha256(stableJson(body));}
function canonicalRequest({method,path,timestamp,nonce,body}){return `${String(method||'GET').toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash(body)}`;}
function signRequest(input,secret){return crypto.createHmac('sha256',String(secret||'')).update(canonicalRequest(input)).digest('hex');}
function verifySignature(input,secret,received){const expected=signRequest(input,secret);const a=Buffer.from(expected,'hex'),b=Buffer.from(String(received||''),'hex');return a.length===b.length&&a.length>0&&crypto.timingSafeEqual(a,b);}
module.exports={stableJson,bodyHash,canonicalRequest,signRequest,verifySignature};
