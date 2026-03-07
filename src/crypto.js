/**
 * Client-side cryptographic identity module for DRT.
 *
 * Uses libsodium (via libsodium-wrappers-sumo) for:
 *   - Ed25519 signing keypairs (identity + recovery)
 *   - XChaCha20-Poly1305 AEAD encryption
 *   - Argon2id password KDF
 *   - Secure random generation
 *
 * Recovery keys are 256-bit random values encoded as dash-separated
 * Crockford Base32 strings with a "DRT-" prefix for easy copy/paste.
 *
 * DATA FLOW:
 *   createIdentity(password)
 *     → generates IK keypair, MK, wraps with password + recovery key
 *     → returns { identityData, recoveryKey }
 *
 *   unlockIdentity(identityData, password)
 *     → derives KEK_pwd → unwraps MK → decrypts IK_priv
 *     → returns { publicKey, privateKey }
 *
 *   recoverWithSeed(identityData, recoveryKey, newPassword)
 *     → derives KEK_rec → unwraps MK → re-wraps with new password
 *     → returns { updatedIdentityData, publicKey, privateKey }
 */

import _sodium from 'libsodium-wrappers-sumo';

let _sodiumReady = null;

// ── Initialization ────────────────────────────────────────────────────

async function ensureReady() {
  if (!_sodiumReady) {
    _sodiumReady = _sodium.ready;
  }
  await _sodiumReady;
  return _sodium;
}

// ── Base64 helpers ────────────────────────────────────────────────────

function toBase64(arr) {
  return _sodium.to_base64(arr, _sodium.base64_variants.ORIGINAL);
}

function fromBase64(str) {
  return _sodium.from_base64(str, _sodium.base64_variants.ORIGINAL);
}

// ── Low-level crypto primitives ───────────────────────────────────────

/**
 * AEAD encrypt with XChaCha20-Poly1305.
 * Returns { ciphertext: Uint8Array, nonce: Uint8Array }
 */
async function aeadEncrypt(plaintext, key) {
  const sodium = await ensureReady();
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES // 24
  );
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,  // message
    null,       // additional data
    null,       // secret nonce (unused, must be null)
    nonce,      // public nonce
    key         // 32-byte key
  );
  return { ciphertext, nonce };
}

/**
 * AEAD decrypt with XChaCha20-Poly1305.
 * Returns plaintext Uint8Array. Throws on failure (wrong key / tampered).
 */
async function aeadDecrypt(ciphertext, nonce, key) {
  const sodium = await ensureReady();
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,       // secret nonce (unused)
    ciphertext, // ciphertext (includes auth tag)
    null,       // additional data
    nonce,      // public nonce
    key         // 32-byte key
  );
}

/**
 * Derive a 32-byte key from a password using Argon2id.
 * If salt is not provided, a new random salt is generated.
 * Uses moderate parameters suitable for desktop.
 */
async function deriveKeyFromPassword(password, salt, opsLimit, memLimit) {
  const sodium = await ensureReady();
  if (!salt) {
    salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES); // 16
  }
  const ops = opsLimit || 3; // OPSLIMIT_MODERATE
  const mem = memLimit || 67108864; // 64 MB (safe for WASM)
  const key = sodium.crypto_pwhash(
    32,
    password,
    salt,
    ops,
    mem,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );
  return { key, salt, opsLimit: ops, memLimit: mem };
}

// ── Recovery key (Crockford Base32) ───────────────────────────────────

/** Crockford Base32 alphabet (case-insensitive, no I/L/O/U) */
const B32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Encode a Uint8Array to Crockford Base32 */
function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += B32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    result += B32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return result;
}

/** Decode Crockford Base32 to Uint8Array */
function base32Decode(str) {
  // Normalize: uppercase, map common confusables
  const normalized = str.toUpperCase()
    .replace(/O/g, '0').replace(/I/g, '1').replace(/L/g, '1').replace(/U/g, 'V');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (let i = 0; i < normalized.length; i++) {
    const idx = B32_ALPHABET.indexOf(normalized[i]);
    if (idx === -1) continue; // skip non-alphabet chars (dashes, spaces)
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

/**
 * Generate a recovery key from 256 bits of cryptographic entropy.
 * Output format: DRT-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XX
 * (52 base32 chars for 32 bytes, split into groups of 5 for readability)
 */
async function generateRecoveryKey() {
  const sodium = await ensureReady();
  const entropy = sodium.randombytes_buf(32); // 256 bits
  const encoded = base32Encode(entropy);
  // Split into groups of 5 for readability, prefix with DRT
  const groups = encoded.match(/.{1,5}/g) || [encoded];
  return 'DRT-' + groups.join('-');
}

/**
 * Parse a recovery key string back to 32 bytes of entropy.
 * Accepts with or without dashes/spaces, case-insensitive.
 */
function parseRecoveryKey(key) {
  // Strip the DRT- prefix if present
  let cleaned = key.trim();
  if (cleaned.toUpperCase().startsWith('DRT-') || cleaned.toUpperCase().startsWith('DRT ')) {
    cleaned = cleaned.slice(4);
  }
  const bytes = base32Decode(cleaned);
  if (bytes.length < 32) {
    throw new Error('Recovery key too short');
  }
  return bytes.slice(0, 32); // exactly 32 bytes
}

/**
 * Derive KEK_rec (for wrapping MK) and recovery Ed25519 keypair from recovery key.
 * Uses libsodium KDF with distinct subkey IDs / contexts.
 */
async function deriveFromRecoveryKey(recoveryKey) {
  const sodium = await ensureReady();
  const entropy = parseRecoveryKey(recoveryKey); // Uint8Array(32)

  // Subkey 1: KEK for wrapping master key
  const kekRecovery = sodium.crypto_kdf_derive_from_key(
    32, 1, 'RECVKEK_', entropy
  );
  // Subkey 2: seed for Ed25519 recovery signing keypair
  const rkSeed = sodium.crypto_kdf_derive_from_key(
    32, 2, 'RECVSGN_', entropy
  );
  const recoveryKeypair = sodium.crypto_sign_seed_keypair(rkSeed);

  return {
    kekRecovery,
    recoveryPublicKey: recoveryKeypair.publicKey,
    recoveryPrivateKey: recoveryKeypair.privateKey,
  };
}

/**
 * Validate a recovery key format.
 * Returns true if the key decodes to exactly 32 bytes.
 */
function isValidRecoveryKey(key) {
  try {
    const bytes = parseRecoveryKey(key);
    return bytes.length === 32;
  } catch {
    return false;
  }
}

// ── High-level identity operations ────────────────────────────────────

/**
 * Create a brand-new cryptographic identity.
 *
 * @param {string} password - User's chosen local password (never sent to server)
 * @returns {{ identityData: object, recoveryKey: string }}
 */
async function createIdentity(password) {
  const sodium = await ensureReady();

  // 1. Generate Ed25519 identity keypair
  const identityKeypair = sodium.crypto_sign_keypair();

  // 2. Generate random 32-byte master key
  const masterKey = sodium.randombytes_buf(32);

  // 3. Encrypt identity private key with master key
  const { ciphertext: encPrivKey, nonce: encPrivKeyNonce } =
    await aeadEncrypt(identityKeypair.privateKey, masterKey);

  // 4. Derive KEK from password, wrap master key
  const { key: kekPwd, salt: pwdSalt, opsLimit, memLimit } =
    await deriveKeyFromPassword(password);
  const { ciphertext: wrapPwd, nonce: wrapPwdNonce } =
    await aeadEncrypt(masterKey, kekPwd);

  // 5. Generate recovery key, derive recovery KEK + RK, wrap master key again
  const recoveryKey = await generateRecoveryKey();
  const { kekRecovery, recoveryPublicKey } =
    await deriveFromRecoveryKey(recoveryKey);
  const { ciphertext: wrapRec, nonce: wrapRecNonce } =
    await aeadEncrypt(masterKey, kekRecovery);

  // 6. Build identity data object (safe to store on disk—all secrets are wrapped)
  const identityData = {
    version: 1,
    identityPublicKey: toBase64(identityKeypair.publicKey),
    encryptedPrivateKey: toBase64(encPrivKey),
    encryptedPrivateKeyNonce: toBase64(encPrivKeyNonce),
    wrappedMasterKeyPassword: toBase64(wrapPwd),
    wrappedMasterKeyPasswordNonce: toBase64(wrapPwdNonce),
    wrappedMasterKeyRecovery: toBase64(wrapRec),
    wrappedMasterKeyRecoveryNonce: toBase64(wrapRecNonce),
    passwordSalt: toBase64(pwdSalt),
    passwordOpsLimit: opsLimit,
    passwordMemLimit: memLimit,
    recoveryPublicKey: toBase64(recoveryPublicKey),
  };

  // 7. Wipe sensitive material from memory
  sodium.memzero(masterKey);
  sodium.memzero(kekPwd);
  sodium.memzero(kekRecovery);

  return { identityData, recoveryKey };
}

/**
 * Unlock an existing identity using the local password.
 *
 * @param {object} identityData - Stored identity data blob
 * @param {string} password - User's local password
 * @returns {{ publicKey: Uint8Array, privateKey: Uint8Array }}
 * @throws {Error} if password is incorrect
 */
async function unlockIdentity(identityData, password) {
  const sodium = await ensureReady();

  // Derive KEK from password
  const { key: kekPwd } = await deriveKeyFromPassword(
    password,
    fromBase64(identityData.passwordSalt),
    identityData.passwordOpsLimit,
    identityData.passwordMemLimit
  );

  // Unwrap master key
  let masterKey;
  try {
    masterKey = await aeadDecrypt(
      fromBase64(identityData.wrappedMasterKeyPassword),
      fromBase64(identityData.wrappedMasterKeyPasswordNonce),
      kekPwd
    );
  } catch (e) {
    throw new Error('Incorrect password');
  }

  // Decrypt identity private key
  const privateKey = await aeadDecrypt(
    fromBase64(identityData.encryptedPrivateKey),
    fromBase64(identityData.encryptedPrivateKeyNonce),
    masterKey
  );

  sodium.memzero(kekPwd);
  sodium.memzero(masterKey);

  return {
    publicKey: fromBase64(identityData.identityPublicKey),
    privateKey,
  };
}

/**
 * Recover identity using the recovery key and set a new password.
 *
 * @param {object} identityData - Stored identity data blob
 * @param {string} recoveryKey - Recovery key string (e.g. DRT-XXXXX-...)
 * @param {string} newPassword - New local password to set
 * @returns {{ updatedIdentityData: object, publicKey: Uint8Array, privateKey: Uint8Array }}
 */
async function recoverWithSeed(identityData, recoveryKey, newPassword) {
  const sodium = await ensureReady();

  const { kekRecovery } = await deriveFromRecoveryKey(recoveryKey);

  // Unwrap master key with recovery KEK
  let masterKey;
  try {
    masterKey = await aeadDecrypt(
      fromBase64(identityData.wrappedMasterKeyRecovery),
      fromBase64(identityData.wrappedMasterKeyRecoveryNonce),
      kekRecovery
    );
  } catch (e) {
    throw new Error('Invalid recovery key');
  }

  // Decrypt identity private key (to verify / return)
  const privateKey = await aeadDecrypt(
    fromBase64(identityData.encryptedPrivateKey),
    fromBase64(identityData.encryptedPrivateKeyNonce),
    masterKey
  );

  // Derive new KEK from new password, re-wrap master key
  const { key: newKekPwd, salt: newPwdSalt, opsLimit, memLimit } =
    await deriveKeyFromPassword(newPassword);
  const { ciphertext: newWrapPwd, nonce: newWrapPwdNonce } =
    await aeadEncrypt(masterKey, newKekPwd);

  const updatedIdentityData = {
    ...identityData,
    wrappedMasterKeyPassword: toBase64(newWrapPwd),
    wrappedMasterKeyPasswordNonce: toBase64(newWrapPwdNonce),
    passwordSalt: toBase64(newPwdSalt),
    passwordOpsLimit: opsLimit,
    passwordMemLimit: memLimit,
  };

  sodium.memzero(masterKey);
  sodium.memzero(newKekPwd);
  sodium.memzero(kekRecovery);

  return {
    updatedIdentityData,
    publicKey: fromBase64(identityData.identityPublicKey),
    privateKey,
  };
}

// ── Backup blob operations ────────────────────────────────────────────

/**
 * Create an encrypted backup blob from identity data.
 * Contains only the recovery-wrapped data (no password-wrapped key).
 * Server cannot decrypt without the recovery seed.
 */
function createBackupBlob(identityData) {
  return JSON.stringify({
    version: 1,
    identityPublicKey: identityData.identityPublicKey,
    encryptedPrivateKey: identityData.encryptedPrivateKey,
    encryptedPrivateKeyNonce: identityData.encryptedPrivateKeyNonce,
    wrappedMasterKeyRecovery: identityData.wrappedMasterKeyRecovery,
    wrappedMasterKeyRecoveryNonce: identityData.wrappedMasterKeyRecoveryNonce,
    recoveryPublicKey: identityData.recoveryPublicKey,
  });
}

/**
 * Restore identity from a backup blob using the recovery seed + a new password.
 *
 * @param {string|object} blob - Backup blob (JSON string or parsed object)
 * @param {string} recoveryKey - Recovery key string (e.g. DRT-XXXXX-...)
 * @param {string} newPassword - New local password
 * @returns {{ identityData: object, publicKey: Uint8Array, privateKey: Uint8Array }}
 */
async function restoreFromBackup(blob, recoveryKey, newPassword) {
  const sodium = await ensureReady();
  const backup = typeof blob === 'string' ? JSON.parse(blob) : blob;

  // Derive recovery keys and verify public key matches
  const { kekRecovery, recoveryPublicKey } =
    await deriveFromRecoveryKey(recoveryKey);

  if (toBase64(recoveryPublicKey) !== backup.recoveryPublicKey) {
    throw new Error('Recovery key does not match this backup');
  }

  // Unwrap master key
  let masterKey;
  try {
    masterKey = await aeadDecrypt(
      fromBase64(backup.wrappedMasterKeyRecovery),
      fromBase64(backup.wrappedMasterKeyRecoveryNonce),
      kekRecovery
    );
  } catch (e) {
    throw new Error('Failed to decrypt backup — invalid recovery key');
  }

  // Verify private key decryption works
  const privateKey = await aeadDecrypt(
    fromBase64(backup.encryptedPrivateKey),
    fromBase64(backup.encryptedPrivateKeyNonce),
    masterKey
  );

  // Wrap master key with new password
  const { key: kekPwd, salt: pwdSalt, opsLimit, memLimit } =
    await deriveKeyFromPassword(newPassword);
  const { ciphertext: wrapPwd, nonce: wrapPwdNonce } =
    await aeadEncrypt(masterKey, kekPwd);

  const identityData = {
    version: 1,
    identityPublicKey: backup.identityPublicKey,
    encryptedPrivateKey: backup.encryptedPrivateKey,
    encryptedPrivateKeyNonce: backup.encryptedPrivateKeyNonce,
    wrappedMasterKeyPassword: toBase64(wrapPwd),
    wrappedMasterKeyPasswordNonce: toBase64(wrapPwdNonce),
    wrappedMasterKeyRecovery: backup.wrappedMasterKeyRecovery,
    wrappedMasterKeyRecoveryNonce: backup.wrappedMasterKeyRecoveryNonce,
    passwordSalt: toBase64(pwdSalt),
    passwordOpsLimit: opsLimit,
    passwordMemLimit: memLimit,
    recoveryPublicKey: backup.recoveryPublicKey,
  };

  sodium.memzero(masterKey);
  sodium.memzero(kekPwd);
  sodium.memzero(kekRecovery);

  return {
    identityData,
    publicKey: fromBase64(backup.identityPublicKey),
    privateKey,
  };
}

// ── Signing ───────────────────────────────────────────────────────────

/**
 * Sign arbitrary data with Ed25519 (detached signature).
 * Returns base64-encoded signature.
 */
async function signData(data, privateKey) {
  const sodium = await ensureReady();
  const message = typeof data === 'string' ? sodium.from_string(data) : data;
  const signature = sodium.crypto_sign_detached(message, privateKey);
  return toBase64(signature);
}

/**
 * Sign a raw base64 challenge (for challenge-response auth).
 * The challenge is decoded from base64 before signing.
 */
async function signChallenge(challengeBase64, privateKey) {
  const sodium = await ensureReady();
  const challenge = fromBase64(challengeBase64);
  const signature = sodium.crypto_sign_detached(challenge, privateKey);
  return toBase64(signature);
}

/**
 * Verify an Ed25519 signature (client-side, for message authenticity).
 */
async function verifySignature(data, signatureBase64, publicKeyBase64) {
  const sodium = await ensureReady();
  try {
    const message = typeof data === 'string' ? sodium.from_string(data) : data;
    const signature = fromBase64(signatureBase64);
    const publicKey = fromBase64(publicKeyBase64);
    return sodium.crypto_sign_verify_detached(signature, message, publicKey);
  } catch {
    return false;
  }
}

/**
 * Create a deterministic signing payload for a message.
 * This is what gets signed by the sender and verified by recipients.
 */
function createMessageSigningPayload(content, channelId, timestamp) {
  return JSON.stringify({ c: content || '', ch: channelId, t: timestamp });
}

export {
  ensureReady,
  toBase64,
  fromBase64,
  isValidRecoveryKey,
  // Identity lifecycle
  createIdentity,
  unlockIdentity,
  recoverWithSeed,
  // Backup
  createBackupBlob,
  restoreFromBackup,
  // Signing
  signData,
  signChallenge,
  verifySignature,
  createMessageSigningPayload,
  // Recovery key helpers
  generateRecoveryKey,
  deriveFromRecoveryKey,
};
