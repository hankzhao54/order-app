// Turn a username or email into a login email.
// Has '@' → treat as a real email (use as-is). Otherwise append the default domain.
export const LOGIN_DOMAIN = 'restaurant.local'
export function toLoginEmail(input) {
  const v = (input || '').trim()
  if (!v) return ''
  if (v.includes('@')) return v.toLowerCase()
  return `${v.toLowerCase().replace(/\s+/g, '')}@${LOGIN_DOMAIN}`
}
