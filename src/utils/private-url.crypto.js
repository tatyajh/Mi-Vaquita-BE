import crypto from 'node:crypto';

const key = secret => crypto.createHash('sha256').update(String(secret || '')).digest();

export const encryptDeliveryUrl = (url, secret=process.env.JWT_SECRET) => {
  if(!secret)throw new Error('JWT_SECRET es requerido para cifrar enlaces privados');
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(secret),iv);
  const ciphertext=Buffer.concat([cipher.update(String(url),'utf8'),cipher.final()]),tag=cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
};

export const decryptDeliveryUrl = (value, secret=process.env.JWT_SECRET) => {
  if(!value)return null;
  if(!String(value).startsWith('enc:v1:'))return String(value);
  if(!secret)throw new Error('JWT_SECRET es requerido para descifrar enlaces privados');
  const [,version,ivText,tagText,cipherText]=String(value).split(':');
  if(version!=='v1'||!ivText||!tagText||!cipherText)throw new Error('Enlace privado cifrado inválido');
  const decipher=crypto.createDecipheriv('aes-256-gcm',key(secret),Buffer.from(ivText,'base64url'));
  decipher.setAuthTag(Buffer.from(tagText,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(cipherText,'base64url')),decipher.final()]).toString('utf8');
};
