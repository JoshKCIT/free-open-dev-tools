// Written by make-fixture.mjs from fixture.wat with wabt 1.0.39. Do not edit by hand.
// The module has an imported function (env.log) and global (env.limit), a memory, a table, a mutable global,
// the data segment "hello fixture", an element segment, the exports memory, add, twice and counter, a start function and
// a name section.
export const FIXTURE_BASE64 =
  'AGFzbQEAAAABEwRgAX8AYAJ/fwF/YAF/AX9gAAACGAIDZW52A2xvZwAAA2VudgVsaW1pdAN/AAMEAwECAwQEAXAAAgUEAQEBBAYGAX8BQQcLByIEBm1lbW9yeQIAA2FkZAABBXR3aWNlAAIHY291bnRlcgMBCAEDCQgBAEEACwIBAgoYAwcAIAAgAWoLBwAgAEECbAsGACMAEAALCxMBAEEQCw1oZWxsbyBmaXh0dXJlAJUBBG5hbWUACAdmaXh0dXJlARkEAANsb2cBA2FkZAIFdHdpY2UDBXN0YXJ0AhkEAAEAAnAwAQIAAnAwAQJwMQIBAAJwMAMABBcEAAVsb2dfdAEFYWRkX3QCAnQyAwJ0MwUGAQADdGJsBgYBAANtZW0HEQIABWxpbWl0AQdjb3VudGVyCAUBAAJlMAkLAQAIZ3JlZXRpbmc=';
export const FIXTURE_BYTES = 329;
export const FIXTURE_SHA256 = '20d21fba08e6e32764d47bfd8c70419836e932c013b52ed514232794046d95a2';

/** The bytes of the fixture module. */
export function fixtureBytes(): Uint8Array {
  return new Uint8Array(Buffer.from(FIXTURE_BASE64, 'base64'));
}
