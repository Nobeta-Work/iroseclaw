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

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function sanitizeAppConfig(config) {
  const next = JSON.parse(JSON.stringify(config || {}));

  if (next.bot && typeof next.bot === 'object') {
    next.bot.uid = 'your_bot_uid';
    if (!next.bot.name || next.bot.name === 'Yesα') {
      next.bot.name = 'YourBotName';
    }
  }

  if (typeof next.roomId === 'string') {
    next.roomId = 'your_room_id';
  }

  next.auth = next.auth && typeof next.auth === 'object' ? next.auth : {};
  next.auth.iiroseUsername = 'your_bot_username';
  next.auth.iirosePassword = 'your_bot_password';

  if (ensureArray(next.admins).length > 0) {
    next.admins = ['your_admin_uid'];
  }

  const namedProviders = next.providers && next.providers.named && typeof next.providers.named === 'object'
    ? next.providers.named
    : {};
  for (const key of Object.keys(namedProviders)) {
    const entry = namedProviders[key];
    if (entry && typeof entry === 'object' && 'apiKey' in entry) {
      entry.apiKey = 'your_api_key';
    }
  }

  return next;
}

function collectSecretsFromAppConfig(config) {
  const secrets = {
    bot: {
      uid: config?.bot?.uid || ''
    },
    roomId: config?.roomId || '',
    auth: {
      iiroseUsername: config?.auth?.iiroseUsername || '',
      iirosePassword: config?.auth?.iirosePassword || ''
    },
    admins: ensureArray(config?.admins),
    providers: {
      namedApiKeys: {}
    }
  };

  const namedProviders = config?.providers?.named && typeof config.providers.named === 'object'
    ? config.providers.named
    : {};
  for (const [key, entry] of Object.entries(namedProviders)) {
    if (entry && typeof entry === 'object' && typeof entry.apiKey === 'string') {
      secrets.providers.namedApiKeys[key] = entry.apiKey;
    }
  }

  return secrets;
}

function sanitizeKoishi(text) {
  return text
    .replace(/^(\s*roomId:\s*).+$/m, '$1your_room_id')
    .replace(/^(\s*usename:\s*).+$/m, '$1your_bot_username')
    .replace(/^(\s*uid:\s*).+$/m, '$1your_bot_uid')
    .replace(/^(\s*password:\s*).+$/m, '$1your_bot_password')
    .replace(/^(\s*nickname:\s*).+$/m, '$1YourBotName');
}

function extractKoishiSecrets(text) {
  const pick = (pattern) => {
    const match = text.match(pattern);
    return match ? String(match[1]).trim() : '';
  };

  return {
    nickname: pick(/^\s*nickname:\s*(.+)$/m),
    roomId: pick(/^\s*roomId:\s*(.+)$/m),
    usename: pick(/^\s*usename:\s*(.+)$/m),
    uid: pick(/^\s*uid:\s*(.+)$/m),
    password: pick(/^\s*password:\s*(.+)$/m)
  };
}

function main() {
  if (!fs.existsSync(appConfigPath)) {
    throw new Error('missing config/app.json');
  }
  if (!fs.existsSync(koishiPath)) {
    throw new Error('missing koishi.yml');
  }

  const appConfig = readJson(appConfigPath);
  const koishiRaw = fs.readFileSync(koishiPath, 'utf8');

  const payload = {
    createdAt: new Date().toISOString(),
    projectRoot,
    files: {
      app: collectSecretsFromAppConfig(appConfig),
      koishi: extractKoishiSecrets(koishiRaw)
    }
  };

  const backupPath = path.join('/tmp', `iroseclaw-secrets-${Date.now()}.json`);
  writeJson(backupPath, payload);

  const sanitizedConfig = sanitizeAppConfig(appConfig);
  writeJson(appConfigPath, sanitizedConfig);
  fs.writeFileSync(koishiPath, sanitizeKoishi(koishiRaw), 'utf8');

  console.log(`Secrets extracted to: ${backupPath}`);
  console.log('Sanitized files: config/app.json, koishi.yml');
}

try {
  main();
} catch (error) {
  console.error(`Failed to extract config: ${error.message}`);
  process.exit(1);
}
