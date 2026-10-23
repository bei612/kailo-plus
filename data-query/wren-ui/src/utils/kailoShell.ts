// DD-138 §2 / design 07 §4.8.1: Kailo and this component are one product.
// Identity, personal settings and sign-out belong to Kailo, embedded or
// top-level; the header keeps only business navigation.

export type HeaderAccount = 'none' | 'identity';

/**
 * What the header shows for the signed-in user. Inside the Kailo frame Kailo
 * already shows the identity, so nothing; top-level visits (sign-in redirects
 * and direct links only) show a read-only identity with no menu and no
 * sign-out — signing out is a Kailo action.
 */
export function headerAccount(
  embedded: boolean,
  hasUser: boolean,
): HeaderAccount {
  return embedded || !hasUser ? 'none' : 'identity';
}
