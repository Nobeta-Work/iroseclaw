function pickFirstText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function getSourceSession(session) {
  if (session?.sourceSession && typeof session.sourceSession === 'object') {
    return session.sourceSession;
  }
  return session || {};
}

function getSessionUserId(session) {
  const source = getSourceSession(session);
  return pickFirstText(
    session?.userId,
    session?.user?.id,
    session?.author?.id,
    session?.event?.user?.id,
    source?.userId,
    source?.user?.id,
    source?.author?.id,
    source?.event?.user?.id
  );
}

function getSessionUsername(session) {
  const source = getSourceSession(session);
  return pickFirstText(
    session?.username,
    session?.user?.name,
    session?.author?.name,
    session?.event?.user?.name,
    source?.username,
    source?.user?.name,
    source?.author?.name,
    source?.event?.user?.name
  );
}

function getSessionChannelId(session) {
  const source = getSourceSession(session);
  return pickFirstText(
    session?.channelId,
    session?.channel?.id,
    session?.chatId,
    session?.event?.channel?.id,
    source?.channelId,
    source?.channel?.id,
    source?.chatId,
    source?.event?.channel?.id
  );
}

function getSessionMessageId(session) {
  const source = getSourceSession(session);
  return pickFirstText(
    session?.messageId,
    session?.id,
    session?.message?.id,
    session?.event?.message?.id,
    source?.messageId,
    source?.id,
    source?.message?.id,
    source?.event?.message?.id
  );
}

module.exports = {
  getSourceSession,
  getSessionUserId,
  getSessionUsername,
  getSessionChannelId,
  getSessionMessageId
};
