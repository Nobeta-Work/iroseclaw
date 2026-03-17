/**
 * IIROSE internal service helpers
 * 为 adapter internal API 提供统一访问层
 */

function getBotInternal(session) {
  return session?.bot?.internal || null;
}

function requireInternalMethod(session, methodName) {
  const internal = getBotInternal(session);
  if (!internal) {
    throw new Error('iirose internal API is unavailable');
  }

  const method = internal[methodName];
  if (typeof method !== 'function') {
    throw new Error(`iirose internal method "${methodName}" is unavailable`);
  }

  return method.bind(internal);
}

async function callInternal(session, methodName, ...args) {
  const method = requireInternalMethod(session, methodName);
  return method(...args);
}

module.exports = {
  getBotInternal,
  requireInternalMethod,
  callInternal
};
