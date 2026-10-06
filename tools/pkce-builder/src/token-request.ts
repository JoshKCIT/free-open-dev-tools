import { MAX_URL_CHARACTERS, checkLength } from './limits';
import { percentEncode } from './request';

export interface TokenRequestFields {
  clientId: string;
  redirectUri: string;
  /** The code verifier of the authorization request, or null when the request had no challenge. */
  verifier: string | null;
}

/** What to remember about the token request: a secret belongs on a server, never in this page. */
export const TOKEN_REQUEST_NOTE =
  'This is text only: the page never sends it. The code goes in place of the placeholder, and the request is made by your application. A client that can keep a secret authenticates at the token endpoint as well, and that secret belongs on a server, never in a page or in an app anyone can unpack, so this page has no field for one. A public client sends the verifier instead.';

/**
 * The body of the token request that trades a code for tokens (RFC 6749 section 4.1.3, RFC 7636 section 4.5): the form
 * fields grant_type, code, redirect_uri, client_id and code_verifier, written once with one percent-encoding pass. The
 * code is a placeholder. The text is never sent by this package.
 */
export function tokenRequestText(fields: TokenRequestFields): { body: string; note: string } {
  checkLength(fields.clientId, MAX_URL_CHARACTERS, 'length', 'client_id');
  checkLength(fields.redirectUri, MAX_URL_CHARACTERS, 'redirect uri', 'redirect address');
  const pieces = ['grant_type=authorization_code', 'code=PASTE_THE_CODE_FROM_THE_REDIRECT'];
  if (fields.redirectUri !== '') pieces.push(`redirect_uri=${percentEncode(fields.redirectUri, 'redirect uri')}`);
  if (fields.clientId !== '') pieces.push(`client_id=${percentEncode(fields.clientId, 'length')}`);
  if (fields.verifier !== null) pieces.push(`code_verifier=${percentEncode(fields.verifier, 'verifier')}`);
  return { body: `Content-Type: application/x-www-form-urlencoded\n\n${pieces.join('&')}`, note: TOKEN_REQUEST_NOTE };
}
