#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const appConfigPath = path.join(projectRoot, 'config', 'app.json');
const koishiPath = path.join(projectRoot, 'koishi.yml');

function readJson(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(text);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function applyKoishiValue(text, key, value) {
  if (!value) return text;
  const pattern = new RegExp(`^(\\s*${key}:\\s*).+$`, 'm');
  return text.replace(pattern, `$1${value}`);
}

function restoreAppConfig(config, backup) {
  const next = JSON.parse(JSON.stringify(config || {}));

  if (next.bot && typeof next.bot === 'object' && backup?.bot?.uid) {
    next.bot.uid = backup.bot.uid;
  }

  if (typeof next.roomId === 'string' && backup?.roomId) {
    next.roomId = backup.roomId;
  }

  next.auth = next.auth && typeof next.auth === 'object' ? next.auth : {};
  if (backup?.auth?.iiroseUsername) {
    next.auth.iiroseUsername = backup.auth.iiroseUsername;
  }
  if (backup?.auth?.iirosePassword) {
    next.auth.iirosePassword = backup.auth.iirosePassword;
  }

  if (Array.isArray(backup?.admins) && backup.admins.length > 0) {
    next.admins = backup.admins;
  }

  const namedProviders = next.providers && next.providers.named && typeof next.providers.named === 'object'
    ? next.providers.named
    : {};
  const apiKeys = backup?.providers?.namedApiKeys && typeof backup.providers.namedApiKeys === 'object'
    ? backup.providers.namedApiKeys
    : {};
  for (const [providerName, apiKey] of Object.entries(apiKeys)) {
    if (namedProviders[providerName] && typeof namedProviders[providerName] === 'object') {
      namedProviders[providerName].apiKey = apiKey;
    }
  }

  return next;
}

function main() {
  const backupPath = process.argv[2];
  if (!backupPath) {
    throw new Error('usage: node scripts/config-restore.js /tmp/iroseclaw-secrets-xxxx.json');
  }

  if (!fs.existsSync(backupPath)) {
    throw new Error(`backup file not found: ${backupPath}`);
  }
  if (!fs.existsSync(appConfigPath)) {
    throw new Error('missing config/app.json');
  }
  if (!fs.existsSync(koishiPath)) {
    throw new Error('missing koishi.yml');
  }

  const backup = readJson(backupPath);
  const appConfig = readJson(appConfigPath);
  const restoredConfig = restoreAppConfig(appConfig, backup?.files?.app || {});
  writeJson(appConfigPath, restoredConfig);

  const koishiRaw = fs.readFileSync(koishiPath, 'utf8');
  const koishiBackup = backup?.files?.koishi || {};
  let koishiNext = koishiRaw;
  koishiNext = applyKoishiValue(koishiNext, 'nickname', koishiBackup.nickname);
  koishiNext = applyKoishiValue(koishiNext, 'roomId', koishiBackup.roomId);
  koishiNext = applyKoishiValue(koishiNext, 'usename', koishiBackup.usename);
  koishiNext = applyKoishiValue(koishiNext, 'uid', koishiBackup.uid);
  koishiNext = applyKoishiValue(koishiNext, 'password', koishiBackup.password);
  fs.writeFileSync(koishiPath, koishiNext, 'utf8');

  console.log(`Restored config from: ${backupPath}`);
}

try {
  main();
} catch (error) {
  console.error(`Failed to restore config: ${error.message}`);
  process.exit(1);
}
