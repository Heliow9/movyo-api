const crypto = require('crypto');
function createObjectId() {
  const ts = Math.floor(Date.now()/1000).toString(16).padStart(8,'0');
  return ts + crypto.randomBytes(8).toString('hex');
}
function normalizeId(id){
  if (!id) return id;
  if (typeof id === 'object' && id._id) return normalizeId(id._id);
  return String(id);
}
module.exports = { createObjectId, normalizeId };
