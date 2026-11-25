// One Argon2id job per disposable worker. Never return/log a password or vendor error.
"use strict";
importScripts(
  "./vendor/libsodium-sumo.js?v=0.8.4",
  "./vendor/libsodium-wrappers.js?v=0.8.4",
);
let used = false;
self.onmessage = async ({ data }) => {
  if (used) return;
  used = true;
  let password = data.password,
    key;
  try {
    const p = data.parameters;
    if (
      !(password instanceof Uint8Array) ||
      !password.length ||
      password.length > 1024 ||
      !(data.salt instanceof Uint8Array) ||
      data.salt.length !== 16 ||
      !Number.isInteger(p?.memoryKiB) ||
      p.memoryKiB < 65536 ||
      p.memoryKiB > 131072 ||
      p.memoryKiB % 1024 ||
      !Number.isInteger(p.iterations) ||
      p.iterations < 3 ||
      p.iterations > 4 ||
      p.parallelism !== 1 ||
      p.memoryKiB * p.iterations > 393216
    )
      throw Error();
    await self.sodium.ready;
    key = self.sodium.crypto_pwhash(
      32,
      password,
      data.salt,
      p.iterations,
      p.memoryKiB * 1024,
      self.sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
    self.postMessage({ key }, [key.buffer]);
  } catch {
    self.postMessage({ error: "BACKUP_KDF_FAILED" });
  } finally {
    password?.fill(0);
    if (key?.byteLength) key.fill(0);
    self.close();
  }
};
