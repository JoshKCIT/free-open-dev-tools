/*
 * Worked examples of ITU-T X.690 (02/2021), retyped as bytes. The bytes are facts the standard states, so they are
 * written here with the clause in each name; the prose of the standard is not copied. Nothing in this file is produced
 * by the code under test.
 */

/**
 * Annex A.3, the personnel record. The standard prints the encoding as a figure; reassembling its octets gives a total
 * length of 136 bytes, a header of 60 81 85 and 133 content octets, exactly as printed.
 */
export const PERSONNEL_HEX =
  '60818561101a044a6f686e1a01501a05536d697468a00a1a084469726563746f72420133a10a43083139373130393137' +
  'a21261101a044d6172791a01541a05536d697468a342311f61111a0552616c70681a01541a05536d697468a00a43083139353731313131' +
  '311f61111a05537573616e1a01421a054a6f6e6573a00a43083139353930373137';

/** The strings of annex A.3 in the order they appear in the record. */
export const PERSONNEL_STRINGS = [
  'John',
  'P',
  'Smith',
  'Director',
  '19710917',
  'Mary',
  'T',
  'Smith',
  'Ralph',
  'T',
  'Smith',
  '19571111',
  'Susan',
  'B',
  'Jones',
  '19590717',
];

export interface X690Literal {
  /** The clause that states the bytes. */
  clause: string;
  name: string;
  /** The encoding as hex. */
  hex: string;
}

/** Hex of the ASCII text, for the string examples. */
function ascii(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) out += text.charCodeAt(i).toString(16).padStart(2, '0');
  return out;
}

export const LITERALS: readonly X690Literal[] = [
  { clause: '8.1.3.4', name: 'short form length, L = 38 as 00100110, on an OCTET STRING of 38 bytes', hex: '0426' + '00'.repeat(38) },
  { clause: '8.1.3.5', name: 'long form length, L = 201 as 10000001 11001001, on an OCTET STRING of 201 bytes', hex: '0481c9' + '00'.repeat(201) },
  { clause: '8.1.3.6', name: 'indefinite length on a constructed SEQUENCE closed by end-of-contents octets', hex: '3080' + '020105' + '0000' },
  { clause: '8.2', name: 'BOOLEAN TRUE', hex: '0101ff' },
  { clause: '8.6.4.2', name: 'BIT STRING 0A3B5F291CD primitive', hex: '030704' + '0a3b5f291cd0' },
  { clause: '8.6.4.2', name: 'BIT STRING 0A3B5F291CD constructed with an indefinite length', hex: '2380' + '030300' + '0a3b' + '030504' + '5f291cd0' + '0000' },
  { clause: '8.8', name: 'NULL', hex: '0500' },
  { clause: '8.9', name: 'SEQUENCE of VisibleString Smith and BOOLEAN TRUE', hex: '300a' + '1605' + ascii('Smith') + '0101ff' },
  { clause: '8.14', name: 'Type4 value Jones, [APPLICATION 7] IMPLICIT [2] [APPLICATION 3] IMPLICIT VisibleString', hex: '6707' + '4305' + ascii('Jones') },
  { clause: '8.19.5', name: 'OBJECT IDENTIFIER 2 999 3 with first subidentifier 1079', hex: '0603883703' },
  { clause: '8.20.5', name: 'RELATIVE-OID 8571 3 2', hex: '0d04c27b0302' },
  { clause: '8.23.5.4', name: 'VisibleString Jones, primitive', hex: '1a05' + ascii('Jones') },
  { clause: '8.23.5.4', name: 'VisibleString Jones, constructed with a definite length', hex: '3a09' + '0403' + ascii('Jon') + '0402' + ascii('es') },
  { clause: '8.23.5.4', name: 'VisibleString Jones, constructed with an indefinite length', hex: '3a80' + '0403' + ascii('Jon') + '0402' + ascii('es') + '0000' },
];
