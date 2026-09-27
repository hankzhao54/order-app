// Usernames sign in as <name>@restaurant.local; a real email is used as-is.
export const LOGIN_DOMAIN = 'restaurant.local'

export function toLoginEmail(input: string): string {
  const v = (input || '').trim()
  if (!v) return ''
  if (v.includes('@')) return v.toLowerCase()
  return `${v.toLowerCase().replace(/\s+/g, '')}@${LOGIN_DOMAIN}`
}

export function displayUsername(email: string | null | undefined): string {
  if (!email) return ''
  return email.endsWith('@' + LOGIN_DOMAIN) ? email.slice(0, -LOGIN_DOMAIN.length - 1) : email
}
