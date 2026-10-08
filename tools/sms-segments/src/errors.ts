/**
 * A refusal of a message. It says what is wrong and which limit applies, and never repeats any of the message, so it can
 * be shown, copied or logged by someone else without leaking what was typed.
 */
export class SmsSegmentsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmsSegmentsError';
  }
}
