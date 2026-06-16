#!/usr/bin/env node
const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();
console.log('WEB_PUSH_SUBJECT=mailto:suporte@movyo.delivery');
console.log(`WEB_PUSH_PUBLIC_KEY=${keys.publicKey}`);
console.log(`WEB_PUSH_PRIVATE_KEY=${keys.privateKey}`);
console.log('\nGuarde a chave privada somente no .env da API. Nunca publique em front-end ou GitHub.');
