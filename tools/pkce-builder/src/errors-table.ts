/**
 * The seven error codes of RFC 6749 section 4.1.2.1, each with one plain sentence. The table is a Map, so a code that comes
 * from a pasted address can never reach anything but its own entry.
 */
export const OAUTH_ERRORS: ReadonlyMap<string, string> = new Map([
  [
    'invalid_request',
    'The request is missing a required parameter, has an invalid value, repeats a parameter or is otherwise malformed.',
  ],
  ['unauthorized_client', 'This client is not allowed to ask for an authorization code this way.'],
  ['access_denied', 'The person using the server, or the server itself, said no to the request.'],
  [
    'unsupported_response_type',
    'The authorization server does not support getting an authorization code the way this request asked.',
  ],
  ['invalid_scope', 'The scope is not valid, not known to the server or not well formed.'],
  [
    'server_error',
    'The authorization server hit an unexpected problem and could not finish the request (it is sent as an error in the redirect because a plain server error page cannot be carried by a redirect).',
  ],
  [
    'temporarily_unavailable',
    'The authorization server is overloaded or down for maintenance right now. Try again later.',
  ],
]);

/** The extra error codes of OpenID Connect Core 1.0 section 3.1.2.6, each with one plain sentence. */
export const OIDC_ERRORS: ReadonlyMap<string, string> = new Map([
  ['interaction_required', 'The server needs the person to do something on screen before it can go on.'],
  ['login_required', 'The server needs the person to sign in, and the request said not to show a sign-in screen.'],
  [
    'account_selection_required',
    'The person has to choose which account to use, and the request said not to show a screen for that.',
  ],
  ['consent_required', 'The server needs the person to agree to share information, and the request said not to ask.'],
  ['invalid_request_uri', 'The request_uri in the request returned an error or holds invalid data.'],
  ['invalid_request_object', 'The request parameter holds a request object that is not valid.'],
  ['request_not_supported', 'The server does not support the request parameter.'],
  ['request_uri_not_supported', 'The server does not support the request_uri parameter.'],
  ['registration_not_supported', 'The server does not support the registration parameter.'],
]);

export const UNKNOWN_ERROR =
  'This error code is not one of those defined by RFC 6749 section 4.1.2.1 or OpenID Connect Core section 3.1.2.6. The documentation of the authorization server says what it means.';

/** The plain sentence for an error code, and whether the code is one a specification defines. */
export function explainError(code: string): { sentence: string; known: boolean } {
  const sentence = OAUTH_ERRORS.get(code) ?? OIDC_ERRORS.get(code);
  return sentence === undefined ? { sentence: UNKNOWN_ERROR, known: false } : { sentence, known: true };
}
