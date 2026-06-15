function pick(value){ return value == null ? '' : String(value); }
module.exports = function requireRestaurantMatch(req,res,next){
  const tokenId=pick(req.restauranteId);
  const requested=pick(
    req.params?.restauranteId || req.params?.idRestaurante || req.body?.restauranteId || req.body?.restaurante || req.query?.restauranteId || req.query?.restaurante
  );
  if(tokenId && requested && tokenId!==requested){
    return res.status(403).json({code:'RESTAURANTE_MISMATCH',mensagem:'Esta sessão não pode acessar dados de outro restaurante.'});
  }
  return next();
};
