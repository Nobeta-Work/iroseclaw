function escapeRegExp(text) {
  if (typeof text !== 'string' || !text) {
    return '';
  }
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isBotMentioned(session, content, botProfile = {}) {
  const botUid = typeof botProfile?.uid === 'string' ? botProfile.uid.trim() : '';
  const botName = typeof botProfile?.name === 'string' ? botProfile.name.trim() : '';
  const text = typeof content === 'string' ? content : '';

  if (session?.isBotMentioned === true) {
    return true;
  }

  if (session?.parsed?.appel) {
    return true;
  }

  if (botUid) {
    const escapedUid = escapeRegExp(botUid);
    const uidPatterns = [
      new RegExp(`\\[at:${escapedUid}\\]`, 'i'),
      new RegExp(`\\[@${escapedUid}@\\]`, 'i'),
      new RegExp(`<at\\b[^>]*\\bid=["']?${escapedUid}["']?[^>]*\\/?>`, 'i'),
      new RegExp(`<at\\b[^>]*\\bid=["']?${escapedUid}["']?[^>]*>.*?<\\/at>`, 'i')
    ];

    if (uidPatterns.some(pattern => pattern.test(text))) {
      return true;
    }
  }

  if (botName) {
    const escapedName = escapeRegExp(botName);
    const namePatterns = [
      new RegExp(`\\[\\*${escapedName}\\*\\]`, 'i'),
      new RegExp(`@${escapedName}\\s*`, 'i'),
      new RegExp(`@${escapedName}$`, 'i'),
      new RegExp(`^${escapedName}[\\s,，:：-]`, 'i'),
      new RegExp(`^\\s*${escapedName}$`, 'i')
    ];

    if (namePatterns.some(pattern => pattern.test(text))) {
      return true;
    }
  }

  return false;
}

function cleanBotMentionContent(content, botProfile = {}) {
  const botUid = typeof botProfile?.uid === 'string' ? botProfile.uid.trim() : '';
  const botName = typeof botProfile?.name === 'string' ? botProfile.name.trim() : '';
  let cleaned = typeof content === 'string' ? content : '';

  cleaned = cleaned.replace(/<at\b[^>]*\/>/gi, ' ');
  cleaned = cleaned.replace(/<at\b[^>]*>.*?<\/at>/gi, ' ');
  cleaned = cleaned.replace(/\[at:[^\]]+\]/gi, ' ');

  if (botUid) {
    const escapedUid = escapeRegExp(botUid);
    cleaned = cleaned.replace(new RegExp(`\\[@${escapedUid}@\\]`, 'gi'), ' ');
  }

  if (botName) {
    const escapedName = escapeRegExp(botName);
    cleaned = cleaned.replace(new RegExp(`\\[\\*${escapedName}\\*\\]`, 'gi'), ' ');
    cleaned = cleaned.replace(new RegExp(`@${escapedName}\\s*`, 'gi'), ' ');
    cleaned = cleaned.replace(new RegExp(`^\\s*${escapedName}[\\s,，:：-]*`, 'i'), ' ');
  }

  return cleaned.replace(/[^\S\r\n]+/g, ' ').trim();
}

module.exports = {
  escapeRegExp,
  isBotMentioned,
  cleanBotMentionContent
};
