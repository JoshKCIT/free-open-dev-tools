import { SamlDecoderError } from './errors';
import {
  NS_ASSERTION,
  NS_PROTOCOL,
  NS_SAML1_ASSERTION,
  NS_SAML1_PROTOCOL,
  NS_XSI,
  allElements,
  attr,
  childElements,
  childrenNamed,
  firstNamed,
  firstTextNode,
  hasCommentChild,
  hasRealText,
  isNamed,
  wholeText,
} from './dom';
import { MAX_NOTES, MAX_ROWS_SHOWN } from './limits';
import { describeTime, formatUtc, parseDateTime } from './times';
import { visible } from './visible';

export type SamlKind = 'AuthnRequest' | 'Response' | 'LogoutRequest' | 'LogoutResponse' | 'Assertion' | 'other';

export interface TimeRow {
  /** Which time: `NotBefore (Conditions)`. */
  field: string;
  /** The time as written. */
  value: string;
  /** The same instant in UTC, or empty when the text is not a time. */
  utc: string;
  /** Where the time stands against the time used, in words. */
  status: string;
}

export interface AttributeRow {
  assertion: string;
  name: string;
  nameFormat: string;
  friendlyName: string;
  value: string;
  type: string;
}

export interface SamlSummary {
  kind: SamlKind;
  /** The message type in words. */
  kindLabel: string;
  /** The summary as rows of name and value. */
  pairs: [string, string][];
  times: TimeRow[];
  attributes: AttributeRow[];
  /** Attribute rows left out because the table is capped. */
  attributesOmitted: number;
  /** Things worth a look, each one sentence. */
  notes: string[];
  assertionCount: number;
}

const SHOWN = 200;
const MAX_AUDIENCES = 20;
const MAX_CONFIRMATIONS = 10;
const STATUS_PREFIX = 'urn:oasis:names:tc:SAML:2.0:status:';

type TimeKind = 'instant' | 'from' | 'until';

function clip(text: string): string {
  return visible(text, SHOWN);
}

function protocolKind(localName: string): SamlKind {
  if (localName === 'AuthnRequest') return 'AuthnRequest';
  if (localName === 'Response') return 'Response';
  if (localName === 'LogoutRequest') return 'LogoutRequest';
  if (localName === 'LogoutResponse') return 'LogoutResponse';
  return 'other';
}

function offsetText(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

function shortStatus(value: string): string {
  return value.startsWith(STATUS_PREFIX) ? value.slice(STATUS_PREFIX.length) : value;
}

function trimmedText(element: Element | null): string {
  return element ? wholeText(element).trim() : '';
}

/**
 * Reads the message the document holds into a summary: type, ID, issuer, destination, the status, each assertion's subject,
 * conditions, audience, authentication and attributes, and every time judged against `now` with no clock skew. It reads the
 * XML as written. Nothing in it is checked: a value that is shown is a value that is there, never one that is right.
 */
export function summarize(document: Document, now: number): SamlSummary {
  const root = document.documentElement;
  if (root.namespaceURI === NS_SAML1_PROTOCOL || root.namespaceURI === NS_SAML1_ASSERTION) {
    throw new SamlDecoderError(
      'This is a SAML 1.x message. Only SAML 2.0 messages are read, so it was not summarised.',
      'message',
    );
  }
  const pairs: [string, string][] = [];
  const times: TimeRow[] = [];
  const attributes: AttributeRow[] = [];
  let attributesOmitted = 0;
  const notes: string[] = [];
  const note = (text: string): void => {
    if (notes.length < MAX_NOTES && !notes.includes(text)) notes.push(text);
  };
  const offsetFields: string[] = [];
  const unreadable: string[] = [];
  const handled = new Set<Element>();

  // ---- times ----
  const addTime = (field: string, text: string, kind: TimeKind): number | null => {
    const parsed = parseDateTime(text);
    if (parsed === null) {
      times.push({ field, value: clip(text), utc: '', status: 'Not an xs:dateTime value, so it cannot be judged' });
      unreadable.push(field);
      return null;
    }
    const relative = describeTime(parsed.ms, now);
    let status: string;
    if (kind === 'instant') {
      status = parsed.ms <= now ? (relative === 'now' ? 'Now' : `Passed ${relative}`) : `Still ahead, ${relative}`;
      if (parsed.ms > now) note(`${field} is later than the time used, and this page allows no clock skew.`);
    } else if (kind === 'from') {
      status = now >= parsed.ms ? `Reached ${relative}` : `Not yet reached, starts ${relative}`;
    } else {
      status = now < parsed.ms ? `Still open, ends ${relative}` : `Expired ${relative}`;
    }
    if (!parsed.hadZone) status += '; no time zone written, read as UTC';
    else if (!parsed.utc) {
      status += `; written with offset ${offsetText(parsed.offsetMinutes)}, not UTC`;
      offsetFields.push(field);
    }
    times.push({ field, value: clip(text), utc: formatUtc(parsed.ms), status });
    return parsed.ms;
  };

  // ---- the message ----
  const isProtocol = root.namespaceURI === NS_PROTOCOL;
  const isAssertionRoot = root.namespaceURI === NS_ASSERTION && root.localName === 'Assertion';
  const kind: SamlKind = isProtocol ? protocolKind(root.localName) : isAssertionRoot ? 'Assertion' : 'other';
  let kindLabel: string;
  if (kind !== 'other') kindLabel = `SAML 2.0 ${kind}`;
  else if (isProtocol || root.namespaceURI === NS_ASSERTION) {
    kindLabel = `SAML 2.0 ${clip(root.localName ?? root.tagName)} (the summary does not cover this type)`;
  } else kindLabel = 'An XML document that is not a SAML 2.0 message';
  pairs.push(['Message', kindLabel]);
  if (kind === 'other' && !isProtocol && root.namespaceURI !== NS_ASSERTION) {
    pairs.push(['Root element', clip(root.tagName)]);
    note('The root element is not a SAML 2.0 element, so only the formatted XML is useful here.');
  }
  const samlRoot = kind !== 'other' || isProtocol || root.namespaceURI === NS_ASSERTION;
  const rootInstant = attr(root, 'IssueInstant');
  if (samlRoot) {
    for (const name of ['ID', 'Version', 'IssueInstant', 'Destination', 'InResponseTo', 'Consent']) {
      const value = attr(root, name);
      if (value !== undefined) pairs.push([name, clip(value)]);
    }
    const version = attr(root, 'Version');
    if (version !== '2.0')
      note(
        `The message says Version ${version === undefined ? '(not written)' : clip(version)}; SAML 2.0 messages say 2.0.`,
      );
    if (rootInstant !== undefined)
      addTime(kind === 'Assertion' ? 'IssueInstant (assertion)' : 'IssueInstant (message)', rootInstant, 'instant');
    const issuer = firstNamed(root, NS_ASSERTION, 'Issuer');
    if (issuer) {
      pairs.push(['Issuer', clip(trimmedText(issuer))]);
      const format = attr(issuer, 'Format');
      if (format !== undefined) pairs.push(['Issuer format', clip(format)]);
    }
  }

  // The identifier of a subject: one reading, or both when a comment splits the text and readers can differ.
  const readNameId = (element: Element, suffix: string): void => {
    handled.add(element);
    const whole = wholeText(element);
    const first = firstTextNode(element);
    if (hasCommentChild(element)) {
      pairs.push([`Subject identifier (first text node)${suffix}`, clip(first.trim())]);
      pairs.push([`Subject identifier (whole text)${suffix}`, clip(whole.trim())]);
      note(
        `A comment sits inside the text of a NameID: a reader that takes the first text node sees '${clip(first.trim())}' and one that takes the whole text sees '${clip(whole.trim())}'. Treat this identifier with care.`,
      );
    } else {
      pairs.push([`Subject identifier${suffix}`, clip(whole.trim())]);
      if (whole !== whole.trim())
        note('A NameID has white space around its text; some readers trim it and some do not.');
    }
    for (const name of ['Format', 'NameQualifier', 'SPNameQualifier']) {
      const value = attr(element, name);
      if (value !== undefined) {
        pairs.push([
          name === 'Format' ? `Subject identifier format${suffix}` : `Subject identifier ${name}${suffix}`,
          clip(value),
        ]);
      }
    }
  };

  // ---- the status of a response ----
  if (kind === 'Response' || kind === 'LogoutResponse') {
    const status = firstNamed(root, NS_PROTOCOL, 'Status');
    if (status) {
      const codes: string[] = [];
      let code = firstNamed(status, NS_PROTOCOL, 'StatusCode');
      for (let depth = 0; code !== null && depth < 8; depth++) {
        codes.push(shortStatus(attr(code, 'Value') ?? '(no value)'));
        code = firstNamed(code, NS_PROTOCOL, 'StatusCode');
      }
      if (codes.length > 0) pairs.push(['Status', clip(codes.join(', then '))]);
      const message = firstNamed(status, NS_PROTOCOL, 'StatusMessage');
      if (message) pairs.push(['Status message', clip(trimmedText(message))]);
    }
    if (attr(root, 'InResponseTo') === undefined) {
      note(
        `The ${kind} has no InResponseTo, so it answers no request that this page can name (an unsolicited response).`,
      );
    }
  }

  // ---- request details ----
  if (kind === 'AuthnRequest') {
    for (const name of [
      'AssertionConsumerServiceURL',
      'AssertionConsumerServiceIndex',
      'ProtocolBinding',
      'ProviderName',
      'ForceAuthn',
      'IsPassive',
    ]) {
      const value = attr(root, name);
      if (value !== undefined) pairs.push([name, clip(value)]);
    }
    const policy = firstNamed(root, NS_PROTOCOL, 'NameIDPolicy');
    if (policy) {
      const parts: string[] = [];
      const format = attr(policy, 'Format');
      if (format !== undefined) parts.push(`Format ${format}`);
      const allow = attr(policy, 'AllowCreate');
      if (allow !== undefined) parts.push(`AllowCreate ${allow}`);
      const qualifier = attr(policy, 'SPNameQualifier');
      if (qualifier !== undefined) parts.push(`SPNameQualifier ${qualifier}`);
      pairs.push(['NameIDPolicy', clip(parts.join(', ') || '(no attributes)')]);
    }
    const context = firstNamed(root, NS_PROTOCOL, 'RequestedAuthnContext');
    if (context) {
      const references = childrenNamed(context, NS_ASSERTION, 'AuthnContextClassRef').map((reference) =>
        trimmedText(reference),
      );
      const comparison = attr(context, 'Comparison');
      const text = [comparison === undefined ? '' : `Comparison ${comparison}`, ...references]
        .filter((part) => part !== '')
        .join('; ');
      pairs.push(['RequestedAuthnContext', clip(text || '(empty)')]);
    }
  }
  if (kind === 'LogoutRequest') {
    const nameId = firstNamed(root, NS_ASSERTION, 'NameID');
    if (nameId) readNameId(nameId, '');
    for (const index of childrenNamed(root, NS_PROTOCOL, 'SessionIndex'))
      pairs.push(['SessionIndex', clip(trimmedText(index))]);
    const reason = attr(root, 'Reason');
    if (reason !== undefined) pairs.push(['Reason', clip(reason)]);
    const notOnOrAfter = attr(root, 'NotOnOrAfter');
    if (notOnOrAfter !== undefined) addTime('NotOnOrAfter (LogoutRequest)', notOnOrAfter, 'until');
  }

  // ---- assertions ----
  let assertions: Element[] = [];
  let encrypted = 0;
  if (kind === 'Assertion') assertions = [root];
  else if (kind === 'Response') {
    assertions = childrenNamed(root, NS_ASSERTION, 'Assertion');
    encrypted = childrenNamed(root, NS_ASSERTION, 'EncryptedAssertion').length;
  }
  if (kind === 'Response') {
    const status = firstNamed(root, NS_PROTOCOL, 'Status');
    const topCode = status ? firstNamed(status, NS_PROTOCOL, 'StatusCode') : null;
    if (
      assertions.length === 0 &&
      encrypted === 0 &&
      topCode &&
      shortStatus(attr(topCode, 'Value') ?? '') === 'Success'
    ) {
      note('The Response reports success but holds no Assertion.');
    }
  }
  if (assertions.length > 1) {
    note(
      `The message holds ${assertions.length} assertions. A reader that takes the first, the last or the signed one can come to a different answer: read the formatted XML as well.`,
    );
  }
  if (encrypted > 0) {
    note(
      `The message holds ${encrypted} encrypted assertion${encrypted === 1 ? '' : 's'}. This page does not decrypt ${encrypted === 1 ? 'it' : 'them'}, so what is inside is not summarised.`,
    );
  }
  const messageIssuer = trimmedText(firstNamed(root, NS_ASSERTION, 'Issuer'));
  assertions.forEach((assertion, position) => {
    const n = position + 1;
    const suffix = assertions.length > 1 ? ` (assertion ${n})` : '';
    const where = assertions.length > 1 ? `, assertion ${n}` : '';
    if (kind !== 'Assertion') {
      const id = attr(assertion, 'ID');
      if (id !== undefined) pairs.push([`Assertion ID${suffix}`, clip(id)]);
      const instant = attr(assertion, 'IssueInstant');
      if (instant !== undefined)
        addTime(`IssueInstant (assertion${assertions.length > 1 ? ` ${n}` : ''})`, instant, 'instant');
      const issuer = firstNamed(assertion, NS_ASSERTION, 'Issuer');
      const issuerText = trimmedText(issuer);
      if (issuer && issuerText !== messageIssuer) {
        pairs.push([`Assertion issuer${suffix}`, clip(issuerText)]);
        if (messageIssuer !== '')
          note(
            `The Issuer of an Assertion differs from the Issuer of the message (${clip(issuerText)} and ${clip(messageIssuer)}).`,
          );
      }
    } else {
      pairs.push(['Assertion ID', clip(attr(assertion, 'ID') ?? '(not written)')]);
    }
    // Subject
    const subject = firstNamed(assertion, NS_ASSERTION, 'Subject');
    if (subject) {
      const nameId = firstNamed(subject, NS_ASSERTION, 'NameID');
      if (nameId) readNameId(nameId, suffix);
      else if (firstNamed(subject, NS_ASSERTION, 'EncryptedID'))
        pairs.push([`Subject identifier${suffix}`, '(encrypted, not decrypted here)']);
      const confirmations = childrenNamed(subject, NS_ASSERTION, 'SubjectConfirmation').slice(0, MAX_CONFIRMATIONS);
      confirmations.forEach((confirmation, k) => {
        const tag = k === 0 ? suffix : `${suffix} ${k + 1}`;
        const method = attr(confirmation, 'Method');
        if (method !== undefined) pairs.push([`Confirmation method${tag}`, clip(method)]);
        const data = firstNamed(confirmation, NS_ASSERTION, 'SubjectConfirmationData');
        if (data) {
          for (const [name, label] of [
            ['Recipient', 'Confirmation recipient'],
            ['InResponseTo', 'Confirmation InResponseTo'],
            ['Address', 'Confirmation address'],
          ] as const) {
            const value = attr(data, name);
            if (value !== undefined) pairs.push([`${label}${tag}`, clip(value)]);
          }
          const from = attr(data, 'NotBefore');
          if (from !== undefined) addTime(`NotBefore (SubjectConfirmationData${where})`, from, 'from');
          const until = attr(data, 'NotOnOrAfter');
          if (until !== undefined) addTime(`NotOnOrAfter (SubjectConfirmationData${where})`, until, 'until');
          if (
            method !== undefined &&
            method.endsWith(':bearer') &&
            attr(data, 'InResponseTo') === undefined &&
            kind === 'Response' &&
            attr(root, 'InResponseTo') !== undefined
          ) {
            note('A bearer confirmation has no InResponseTo although the Response has one.');
          }
        }
      });
    }
    // Conditions
    const conditions = firstNamed(assertion, NS_ASSERTION, 'Conditions');
    if (!conditions) {
      note(`The assertion${where} has no Conditions, so nothing limits when or where it may be used.`);
    } else {
      const from = attr(conditions, 'NotBefore');
      const until = attr(conditions, 'NotOnOrAfter');
      const fromMs = from !== undefined ? addTime(`NotBefore (Conditions${where})`, from, 'from') : null;
      const untilMs = until !== undefined ? addTime(`NotOnOrAfter (Conditions${where})`, until, 'until') : null;
      if (from !== undefined) pairs.push([`Valid from${suffix}`, clip(from)]);
      if (until !== undefined) pairs.push([`Valid until${suffix}`, clip(until)]);
      if (until === undefined)
        note(`The Conditions of the assertion${where} have no NotOnOrAfter, so it has no written end.`);
      const restrictions = childrenNamed(conditions, NS_ASSERTION, 'AudienceRestriction');
      let audienceCount = 0;
      restrictions.forEach((restriction, k) => {
        const audiences = childrenNamed(restriction, NS_ASSERTION, 'Audience');
        audienceCount += audiences.length;
        const listed = audiences.slice(0, MAX_AUDIENCES).map((audience) => clip(trimmedText(audience)));
        if (audiences.length > MAX_AUDIENCES) listed.push(`and ${audiences.length - MAX_AUDIENCES} more`);
        const label = restrictions.length > 1 ? `Audience restriction ${k + 1}${suffix}` : `Audience${suffix}`;
        pairs.push([label, listed.join(', ') || '(none written)']);
      });
      if (audienceCount === 0)
        note(`The assertion${where} has no Audience, so nothing says which service it is meant for.`);
      if (firstNamed(conditions, NS_ASSERTION, 'OneTimeUse')) pairs.push([`One-time use${suffix}`, 'Yes']);
      // The window at the time used
      let text: string;
      const unreadableHere = (from !== undefined && fromMs === null) || (until !== undefined && untilMs === null);
      if (unreadableHere) text = 'Cannot be judged: a time is not readable';
      else if (fromMs === null && untilMs === null) text = 'No window written';
      else if (fromMs !== null && now < fromMs) {
        text = `Before the window (it starts ${describeTime(fromMs, now)})`;
        note(`At the time used the Conditions window of the assertion${where} has not started.`);
      } else if (untilMs !== null && now >= untilMs) {
        text = `After the window (it ended ${describeTime(untilMs, now)})`;
        note(`At the time used the Conditions window of the assertion${where} has ended.`);
      } else text = 'Inside the window at the time used';
      pairs.push([`Time window${suffix}`, text]);
    }
    // Authentication
    const statement = firstNamed(assertion, NS_ASSERTION, 'AuthnStatement');
    if (statement) {
      const instant = attr(statement, 'AuthnInstant');
      if (instant !== undefined) addTime(`AuthnInstant${where === '' ? '' : ` (assertion ${n})`}`, instant, 'instant');
      const session = attr(statement, 'SessionIndex');
      if (session !== undefined) pairs.push([`Session index${suffix}`, clip(session)]);
      const sessionEnd = attr(statement, 'SessionNotOnOrAfter');
      if (sessionEnd !== undefined)
        addTime(`SessionNotOnOrAfter${where === '' ? '' : ` (assertion ${n})`}`, sessionEnd, 'until');
      const context = firstNamed(statement, NS_ASSERTION, 'AuthnContext');
      const reference = context ? firstNamed(context, NS_ASSERTION, 'AuthnContextClassRef') : null;
      if (reference) pairs.push([`Authentication context${suffix}`, clip(trimmedText(reference))]);
    }
    // Attributes
    let attributeCount = 0;
    let valueCount = 0;
    for (const attributeStatement of childrenNamed(assertion, NS_ASSERTION, 'AttributeStatement')) {
      for (const child of childElements(attributeStatement)) {
        if (isNamed(child, NS_ASSERTION, 'EncryptedAttribute')) {
          note('An encrypted attribute is present. This page does not decrypt it.');
          continue;
        }
        if (!isNamed(child, NS_ASSERTION, 'Attribute')) continue;
        attributeCount++;
        const base = {
          assertion: String(n),
          name: clip(attr(child, 'Name') ?? ''),
          nameFormat: clip(attr(child, 'NameFormat') ?? ''),
          friendlyName: clip(attr(child, 'FriendlyName') ?? ''),
        };
        const values = childrenNamed(child, NS_ASSERTION, 'AttributeValue');
        const rowsFor = values.length === 0 ? [null] : values;
        for (const value of rowsFor) {
          let text: string;
          let type = '';
          if (value === null) text = '(no value)';
          else {
            valueCount++;
            type = clip(value.getAttributeNS(NS_XSI, 'type') ?? '');
            text =
              childElements(value).length > 0
                ? '(holds XML elements: see the formatted XML)'
                : clip(wholeText(value).trim());
          }
          if (attributes.length < MAX_ROWS_SHOWN) attributes.push({ ...base, value: text, type });
          else attributesOmitted++;
        }
      }
    }
    if (attributeCount > 0) {
      pairs.push([
        `Attributes${suffix}`,
        `${attributeCount} attribute${attributeCount === 1 ? '' : 's'}, ${valueCount} value${valueCount === 1 ? '' : 's'}`,
      ]);
    }
  });

  // ---- text split by a comment, anywhere else in the message ----
  for (const element of allElements(root)) {
    if (handled.has(element) || !hasCommentChild(element) || !hasRealText(element)) continue;
    note(`A comment sits inside the text of ${clip(element.tagName)}: readers can disagree about what that text is.`);
  }
  if (offsetFields.length > 0) {
    note(
      `Times written with an offset other than UTC: ${offsetFields.slice(0, 5).join(', ')}. SAML Core says times are written in UTC.`,
    );
  }
  if (unreadable.length > 0) {
    note(`A time is not an xs:dateTime value: ${unreadable.slice(0, 5).join(', ')}. It cannot be judged.`);
  }
  if (times.length > 0) pairs.push(['Time used', `${formatUtc(now)} (no clock skew is allowed)`]);
  return { kind, kindLabel, pairs, times, attributes, attributesOmitted, notes, assertionCount: assertions.length };
}
