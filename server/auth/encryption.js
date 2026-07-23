const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM

function getEncryptionKey() {
  const secret = process.env.ENCRYPTION_KEY || "default-homework-app-development-secret-key-32-bytes";
  // Derive a fixed 32-byte key via scrypt
  return crypto.scryptSync(secret, "homework-fetcher-salt", 32);
}

/**
 * Encrypts plaintext string using AES-256-GCM.
 * @param {string} text 
 * @returns {string} iv:authTag:encryptedContent
 */
function encrypt(text) {
  if (!text) return "";
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypts encrypted string formatted as iv:authTag:encryptedContent.
 * @param {string} encryptedText 
 * @returns {string|null}
 */
function decrypt(encryptedText) {
  if (!encryptedText) return null;
  try {
    const parts = encryptedText.split(":");
    if (parts.length !== 3) return null;
    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.error("Decryption failure:", err.message);
    return null;
  }
}

module.exports = {
  encrypt,
  decrypt
};
