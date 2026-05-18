const HEX24 = /^[a-fA-F0-9]{24}$/;
function ObjectId(value) { return String(value || ''); }
ObjectId.isValid = (value) => HEX24.test(String(value || ''));
module.exports = { Types: { ObjectId }, isValidObjectId: ObjectId.isValid };

module.exports.startSession = async () => ({ withTransaction: async (fn) => fn(), endSession: () => {} });
