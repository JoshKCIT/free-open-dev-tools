/**
 * Asserts Protocol Buffers, Swift and Dart output against the Protocol
 * Buffers Language Specification (proto3), the ProtoJSON format, the proto3
 * Language Guide's reserved field-number range, Swift's Lexical Structure
 * page and Dart's keyword list -- all fetched live before this file was
 * written; see naming.ts for the quoted fetched text. No Swift, Dart or
 * protoc compiler is available locally, so every golden string here is
 * hand-derived from those rules and checked directly, never pasted from a
 * tool's own output.
 */
import { it, expect } from 'vitest';
import { jsonToCode, LANGUAGES } from '../src/index';
import { assignNames, assignProtobufFieldNames, camelCase, protobufDefaultJsonName } from '../src/naming';

const GOLDEN_SAMPLE =
  '{"id":1,"userName":"Ada","score":9.5,"active":true,"tags":["x"],"address":{"city":"Paris"},' +
  '"class":"admin","weird key":"x","nickname":null,"matrix":[[1,2]],"extra":[1,"x"]}';

it('LANGUAGES lists every language the page can select, in the catalog summary order (P-01)', () => {
  expect(LANGUAGES).toEqual([
    'typescript',
    'go',
    'rust',
    'python',
    'java',
    'csharp',
    'kotlin',
    'php',
    'swift',
    'dart',
    'protobuf',
  ]);
});

// --- Golden outputs, one per new language ----------------------------------

it('Protocol Buffers renders the golden sample exactly (proto3 spec, ProtoJSON default names)', () => {
  const { output } = jsonToCode(GOLDEN_SAMPLE, { language: 'protobuf', rootName: 'Root' });
  const expected = [
    'syntax = "proto3";',
    '',
    'import "google/protobuf/struct.proto";',
    '',
    'message Root {',
    '  int64 id = 1;',
    '  string user_name = 2;',
    '  double score = 3;',
    '  bool active = 4;',
    '  repeated string tags = 5;',
    '  Address address = 6;',
    '  string class = 7;',
    '  string weird_key = 8 [json_name = "weird key"];',
    '  google.protobuf.Value nickname = 9;',
    '  repeated google.protobuf.ListValue matrix = 10;',
    '  repeated google.protobuf.Value extra = 11;',
    '}',
    '',
    'message Address {',
    '  string city = 1;',
    '}',
    '',
  ].join('\n');
  expect(output).toBe(expected);
});

it('Swift renders the golden sample exactly (Codable structs, one shared JSONValue enum)', () => {
  const { output } = jsonToCode(GOLDEN_SAMPLE, { language: 'swift', rootName: 'Root' });
  const expected = [
    'import Foundation',
    '',
    'struct Root: Codable {',
    '  let id: Int',
    '  let userName: String',
    '  let score: Double',
    '  let active: Bool',
    '  let tags: [String]',
    '  let address: Address',
    '  let `class`: String',
    '  let weirdKey: String',
    '  let nickname: JSONValue?',
    '  let matrix: [[Int]]',
    '  let extra: [JSONValue]',
    '',
    '  enum CodingKeys: String, CodingKey {',
    '    case id',
    '    case userName',
    '    case score',
    '    case active',
    '    case tags',
    '    case address',
    '    case `class`',
    '    case weirdKey = "weird key"',
    '    case nickname',
    '    case matrix',
    '    case extra',
    '  }',
    '}',
    '',
    'struct Address: Codable {',
    '  let city: String',
    '}',
    '',
    'enum JSONValue: Codable {',
    '  case string(String)',
    '  case number(Double)',
    '  case bool(Bool)',
    '  case object([String: JSONValue])',
    '  case array([JSONValue])',
    '  case null',
    '',
    '  init(from decoder: Decoder) throws {',
    '    let container = try decoder.singleValueContainer()',
    '    if container.decodeNil() {',
    '      self = .null',
    '    } else if let value = try? container.decode(Bool.self) {',
    '      self = .bool(value)',
    '    } else if let value = try? container.decode(Double.self) {',
    '      self = .number(value)',
    '    } else if let value = try? container.decode(String.self) {',
    '      self = .string(value)',
    '    } else if let value = try? container.decode([JSONValue].self) {',
    '      self = .array(value)',
    '    } else if let value = try? container.decode([String: JSONValue].self) {',
    '      self = .object(value)',
    '    } else {',
    '      throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value.")',
    '    }',
    '  }',
    '',
    '  func encode(to encoder: Encoder) throws {',
    '    var container = encoder.singleValueContainer()',
    '    switch self {',
    '    case .string(let value): try container.encode(value)',
    '    case .number(let value): try container.encode(value)',
    '    case .bool(let value): try container.encode(value)',
    '    case .object(let value): try container.encode(value)',
    '    case .array(let value): try container.encode(value)',
    '    case .null: try container.encodeNil()',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
  expect(output).toBe(expected);
});

it('Dart renders the golden sample exactly (json_serializable classes)', () => {
  const { output } = jsonToCode(GOLDEN_SAMPLE, { language: 'dart', rootName: 'Root' });
  const expected = [
    "import 'package:json_annotation/json_annotation.dart';",
    '',
    "part 'root.g.dart';",
    '',
    '@JsonSerializable()',
    'class Root {',
    '  final int id;',
    '  final String userName;',
    '  final double score;',
    '  final bool active;',
    '  final List<String> tags;',
    '  final Address address;',
    "  @JsonKey(name: 'class')",
    '  final String class_;',
    "  @JsonKey(name: 'weird key')",
    '  final String weirdKey;',
    '  final Object? nickname;',
    '  final List<List<int>> matrix;',
    '  final List<Object> extra;',
    '',
    '  Root({',
    '    required this.id,',
    '    required this.userName,',
    '    required this.score,',
    '    required this.active,',
    '    required this.tags,',
    '    required this.address,',
    '    required this.class_,',
    '    required this.weirdKey,',
    '    this.nickname,',
    '    required this.matrix,',
    '    required this.extra,',
    '  });',
    '',
    '  factory Root.fromJson(Map<String, dynamic> json) => _$RootFromJson(json);',
    '  Map<String, dynamic> toJson() => _$RootToJson(this);',
    '}',
    '',
    '@JsonSerializable()',
    'class Address {',
    '  final String city;',
    '',
    '  Address({',
    '    required this.city,',
    '  });',
    '',
    '  factory Address.fromJson(Map<String, dynamic> json) => _$AddressFromJson(json);',
    '  Map<String, dynamic> toJson() => _$AddressToJson(this);',
    '}',
    '',
  ].join('\n');
  expect(output).toBe(expected);
});

// --- Optional and nullable --------------------------------------------------

it('a key missing from some instances or ever null becomes optional/nullable in all three languages', () => {
  const sample = '[{"a":1,"b":"x"},{"a":null}]';

  const protobuf = jsonToCode(sample, { language: 'protobuf', rootName: 'Root' }).output;
  expect(protobuf).toContain('optional int64 a = 1;');
  expect(protobuf).toContain('optional string b = 2;');

  const swift = jsonToCode(sample, { language: 'swift', rootName: 'Root' }).output;
  expect(swift).toContain('let a: Int?');
  expect(swift).toContain('let b: String?');

  const dart = jsonToCode(sample, { language: 'dart', rootName: 'Root' }).output;
  expect(dart).toContain('final int? a;');
  expect(dart).toContain('final String? b;');
  expect(dart).toContain('this.a,');
  expect(dart).toContain('this.b,');
  expect(dart).not.toContain('required this.a,');
  expect(dart).not.toContain('required this.b,');
});

// --- Nested arrays -----------------------------------------------------------

it('a nested array becomes google.protobuf.ListValue, [[T]] and List<List<T>>, with a warning naming the key', () => {
  const sample = '{"m":[[1,2],[3]]}';

  const protobuf = jsonToCode(sample, { language: 'protobuf', rootName: 'Root' });
  expect(protobuf.output).toContain('import "google/protobuf/struct.proto";');
  expect(protobuf.output).toContain('repeated google.protobuf.ListValue m = 1;');
  expect(protobuf.warnings.join(' ')).toContain('"m"');

  const swift = jsonToCode(sample, { language: 'swift', rootName: 'Root' }).output;
  expect(swift).toContain('let m: [[Int]]');

  const dart = jsonToCode(sample, { language: 'dart', rootName: 'Root' }).output;
  expect(dart).toContain('final List<List<int>> m;');
});

// --- Null-holding array ------------------------------------------------------

it('an array that held null becomes google.protobuf.Value, [T?] and List<T?>, with a warning naming the key', () => {
  const sample = '{"n":[1,null]}';

  const protobuf = jsonToCode(sample, { language: 'protobuf', rootName: 'Root' });
  expect(protobuf.output).toContain('repeated google.protobuf.Value n = 1;');
  expect(protobuf.warnings.join(' ')).toContain('"n"');

  const swift = jsonToCode(sample, { language: 'swift', rootName: 'Root' }).output;
  expect(swift).toContain('let n: [Int?]');

  const dart = jsonToCode(sample, { language: 'dart', rootName: 'Root' }).output;
  expect(dart).toContain('final List<int?> n;');
});

// --- Any-JSON: one shared type, emitted only when needed --------------------

it('two any-JSON fields still emit exactly one Swift JSONValue enum', () => {
  const sample = '{"a":null,"b":[1,"x"]}';
  const { output } = jsonToCode(sample, { language: 'swift', rootName: 'Root' });
  const matches = output.match(/enum JSONValue: Codable \{/g);
  expect(matches).toHaveLength(1);
});

it('a sample with no any-JSON emits no protobuf struct.proto import and no google.protobuf type', () => {
  const { output } = jsonToCode('{"a":1}', { language: 'protobuf', rootName: 'Root' });
  expect(output).not.toContain('google/protobuf/struct.proto');
  expect(output).not.toContain('google.protobuf');
});

it('a sample with no any-JSON emits no Swift JSONValue enum', () => {
  const { output } = jsonToCode('{"a":1}', { language: 'swift', rootName: 'Root' });
  expect(output).not.toContain('JSONValue');
});

// --- Protobuf naming ---------------------------------------------------------

it('a key already in lowerCamelCase form needs no json_name; a later colliding key does, per ProtoJSON default names', () => {
  const names = assignProtobufFieldNames(['userId', 'user_id']);
  expect(names.get('userId')).toBe('user_id');
  expect(names.get('user_id')).toBe('user_id2');
  expect(protobufDefaultJsonName(names.get('userId')!)).toBe('userId');
  expect(protobufDefaultJsonName(names.get('user_id')!)).not.toBe('user_id');
});

it('field names assigned to two keys that could collide always end up with distinct default JSON names, per the proto3 JSON-name uniqueness rule', () => {
  const names = assignProtobufFieldNames(['a-1', 'a1']);
  const a1Name = names.get('a-1')!;
  const a2Name = names.get('a1')!;
  expect(a1Name).not.toBe(a2Name);
  expect(protobufDefaultJsonName(a1Name)).not.toBe(protobufDefaultJsonName(a2Name));
});

it('a key starting with a digit after conversion gets an n_ prefix, and json_name carries the original key', () => {
  const names = assignProtobufFieldNames(['2fa-enabled']);
  const name = names.get('2fa-enabled')!;
  expect(name).toBe('n_2fa_enabled');
  expect(protobufDefaultJsonName(name)).not.toBe('2fa-enabled');
});

it('an empty key becomes "field" and needs a json_name of the empty string', () => {
  const names = assignProtobufFieldNames(['']);
  const name = names.get('')!;
  expect(name).toBe('field');
  expect(protobufDefaultJsonName(name)).not.toBe('');
});

it('a proto3 keyword key gets a trailing underscore and, per protoc dropping it from the default JSON name, needs no json_name (P-05)', () => {
  const names = assignProtobufFieldNames(['message']);
  const name = names.get('message')!;
  expect(name).toBe('message_');
  expect(protobufDefaultJsonName(name)).toBe('message');
});

it('an all-uppercase-then-mixed-case key splits at the camelCase boundary, e.g. HTTPServer -> http_server, and needs a json_name', () => {
  const names = assignProtobufFieldNames(['HTTPServer']);
  const name = names.get('HTTPServer')!;
  expect(name).toBe('http_server');
  expect(protobufDefaultJsonName(name)).not.toBe('HTTPServer');
});

it('every assigned protobuf field name is a valid, lowercase proto3 identifier', () => {
  const keys = ['id', 'userId', 'user_id', '2fa-enabled', '', 'message', 'HTTPServer', 'a-1', 'a1', 'class'];
  const names = assignProtobufFieldNames(keys);
  for (const key of keys) {
    expect(names.get(key)!, key).toMatch(/^[a-z][a-z0-9_]*$/);
  }
});

it('protobuf field numbers skip the 19000-19999 reserved range for a large message (proto3 Language Guide)', () => {
  const keys = Array.from({ length: 19001 }, (_, i) => `k${i}`);
  const sample = JSON.stringify(Object.fromEntries(keys.map((k) => [k, 1])));
  const { output } = jsonToCode(sample, { language: 'protobuf', rootName: 'Root' });
  const numbers = [...output.matchAll(/= (\d+)/g)].map((m) => Number(m[1]));
  expect(numbers).toHaveLength(19001);
  expect(Math.max(...numbers)).toBe(20001);
  expect(numbers.some((n) => n >= 19000 && n <= 19999)).toBe(false);
});

it('a non-object top-level array emits message RootItem plus one top-level warning', () => {
  const { output, warnings } = jsonToCode('[{"a":1}]', { language: 'protobuf', rootName: 'Root' });
  expect(output).toContain('message RootItem {');
  expect(output).not.toContain('message Root {');
  const topLevelWarnings = warnings.filter((w) => w.toLowerCase().includes('top-level'));
  expect(topLevelWarnings).toHaveLength(1);
});

// --- Swift naming ------------------------------------------------------------

it('a Swift keyword property is backticked, and its CodingKeys case is a bare backticked name (no raw value) when the bare name already equals the key', () => {
  const { output } = jsonToCode('{"class":1,"weird key":2}', { language: 'swift', rootName: 'Root' });
  expect(output).toContain('let `class`: Int');
  expect(output).toContain('    case `class`');
  expect(output).not.toContain('case `class` =');
});

it('camelCase collisions in Swift property names are resolved the same way assignNames resolves any collision', () => {
  const names = assignNames(['a-b', 'a_b'], (key) => camelCase(key, 'value'));
  expect(names.get('a-b')).toBe('aB');
  expect(names.get('a_b')).toBe('aB2');
});

it('an object key that would shadow JSONValue or CodingKeys gets a Type suffix', () => {
  const jsonValueClash = jsonToCode('{"JSONValue":{"x":1}}', { language: 'swift', rootName: 'Root' }).output;
  expect(jsonValueClash).toContain('struct JSONValueType: Codable {');

  const codingKeysClash = jsonToCode('{"codingKeys":{"x":1}}', { language: 'swift', rootName: 'Root' }).output;
  expect(codingKeysClash).toContain('struct CodingKeysType: Codable {');
});

it('a Swift struct whose property names all equal their keys has no CodingKeys enum at all', () => {
  const { output } = jsonToCode('{"a":1,"b":2}', { language: 'swift', rootName: 'Root' });
  expect(output).not.toContain('CodingKeys');
});

// --- Dart naming ---------------------------------------------------------

it("a key that collides with json_serializable's own generated member gets a trailing underscore and an @JsonKey", () => {
  const { output } = jsonToCode('{"toJson":1}', { language: 'dart', rootName: 'Root' });
  expect(output).toContain("@JsonKey(name: 'toJson')");
  expect(output).toContain('final int toJson_;');
});

it("an object key that would shadow Dart's own Function type gets a Type suffix", () => {
  const { output } = jsonToCode('{"function":{"x":1}}', { language: 'dart', rootName: 'Root' });
  expect(output).toContain('class FunctionType {');
});

it('the Dart part file name is the lower_snake_case of the root type name', () => {
  const { output } = jsonToCode('{"a":1}', { language: 'dart', rootName: 'UserProfile' });
  expect(output).toContain("part 'user_profile.g.dart';");
});

// --- Literal escaping (injection guard) --------------------------------------

it('a key built from a quote, backslash, single quote, dollar sign and newline never breaks out of a string literal', () => {
  const weirdKey = '"' + '\\' + "'" + '$' + '\n';
  const weirdSample = JSON.stringify({ [weirdKey]: 1 });
  // "plain word" (not "plainWord"): needs the same rename/CodingKeys/@JsonKey
  // structure the weird key needs, so only the literal escaping itself
  // differs between the two outputs, not the surrounding shape.
  const plainSample = JSON.stringify({ 'plain word': 1 });

  for (const language of ['protobuf', 'swift', 'dart'] as const) {
    const weird = jsonToCode(weirdSample, { language, rootName: 'Root' }).output;
    const plain = jsonToCode(plainSample, { language, rootName: 'Root' }).output;
    expect(weird.split('\n').length, language).toBe(plain.split('\n').length);
  }

  const protobufOutput = jsonToCode(weirdSample, { language: 'protobuf', rootName: 'Root' }).output;
  expect(protobufOutput).toContain('\\"');
  expect(protobufOutput).toContain('\\\\');
  expect(protobufOutput).toContain('\\n');

  const swiftOutput = jsonToCode(weirdSample, { language: 'swift', rootName: 'Root' }).output;
  expect(swiftOutput).toContain('\\"');
  expect(swiftOutput).toContain('\\\\');
  expect(swiftOutput).toContain('\\n');

  const dartOutput = jsonToCode(weirdSample, { language: 'dart', rootName: 'Root' }).output;
  expect(dartOutput).toContain("\\'");
  expect(dartOutput).toContain('\\\\');
  expect(dartOutput).toContain('\\$');
  expect(dartOutput).toContain('\\n');
});

// --- Empty object ------------------------------------------------------------

it('an empty object renders an empty message, struct and class in all three languages', () => {
  const protobuf = jsonToCode('{}', { language: 'protobuf', rootName: 'Root' }).output;
  expect(protobuf).toContain('message Root {\n}');

  const swift = jsonToCode('{}', { language: 'swift', rootName: 'Root' }).output;
  expect(swift).toContain('struct Root: Codable {\n}');

  const dart = jsonToCode('{}', { language: 'dart', rootName: 'Root' }).output;
  expect(dart).toContain('class Root {');
  expect(dart).toContain('Root();');
  expect(dart).toContain('factory Root.fromJson(Map<String, dynamic> json) => _$RootFromJson(json);');
  expect(dart).toContain('Map<String, dynamic> toJson() => _$RootToJson(this);');
});
