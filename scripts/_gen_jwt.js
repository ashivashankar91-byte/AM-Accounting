const crypto = require('crypto');

function base64UrlEncode(data) {
  if (typeof data === 'string') {
    return Buffer.from(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
  return data.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

const secret = process.env.AMACC_JWT_SECRET || 'dev-jwt-secret-change-in-production-min16';
const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const payload = base64UrlEncode(JSON.stringify({
  sub: 'lee-hyundai-01',
  tenantId: 'lee-hyundai-01',
  role: 'CONTROLLER',
  scopes: ['read', 'write'],
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 28800,
  iss: 'amacc',
}));
const signatureInput = `${header}.${payload}`;
const signature = base64UrlEncode(
  crypto.createHmac('sha256', secret).update(signatureInput).digest('binary')
);
console.log(`${header}.${payload}.${signature}`);
