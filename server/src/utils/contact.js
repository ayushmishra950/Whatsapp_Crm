/**
 * How a lead is shown when it has no name: the WhatsApp number, else the Instagram @username.
 * Instagram leads may have no phone at all, so never print `+${contact.phone}` directly.
 */
export const hasPhone = (contact) => !!contact?.phone;

export function displayName(contact) {
  if (!contact) return '';
  const name = String(contact.name || '').trim();
  if (name) return name;
  if (contact.phone) return `+${contact.phone}`;
  if (contact.instagram?.username) return `@${contact.instagram.username}`;
  return 'Instagram user';
}
