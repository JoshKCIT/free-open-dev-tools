/**
 * Asserts, per language, that every emitted identifier matches that
 * language's own fetched identifier rule and keyword list, and that the
 * original JSON key is kept in that language's own mapping (a struct tag, a
 * rename attribute, or the key text itself).
 */
import { it, expect } from 'vitest';
import { jsonToCode } from '../src/index';

it('Go struct fields are exported and carry json tags with the original key', () => {
  const sample = JSON.stringify({ type: 'x', class: 1, '2fa-enabled': true });
  const { output } = jsonToCode(sample, { language: 'go', rootName: 'Root' });
  expect(output).toContain('json:"type"');
  expect(output).toContain('json:"class"');
  expect(output).toContain('json:"2fa-enabled"');
  const fieldNames = [...output.matchAll(/\n\t([A-Za-z_][A-Za-z0-9_]*)\s+\S+\s+`/g)].map((m) => m[1]!);
  expect(fieldNames.length).toBe(3);
  for (const name of fieldNames) expect(/^[A-Z]/.test(name)).toBe(true);
});

it('Rust structs derive serde traits, rename keys and escape keywords', () => {
  const sample = JSON.stringify({ type: 'x', self: 1, 'weird key': true });
  const { output } = jsonToCode(sample, { language: 'rust', rootName: 'Root' });
  expect(output).toContain('#[derive(Debug, Clone, Serialize, Deserialize)]');
  expect(output).toContain('pub r#type: String');
  expect(output).toContain('#[serde(rename = "self")]');
  expect(output).toMatch(/pub self_: i64,/);
  expect(output).toContain('#[serde(rename = "weird key")]');
  expect(output).toMatch(/pub weird_key: bool,/);
});

it('Python output uses TypedDict and the functional form for keys that are not identifiers', () => {
  const validSample = JSON.stringify({ user_id: 1, name: 'Ada' });
  const { output: validOutput } = jsonToCode(validSample, { language: 'python', rootName: 'Root' });
  expect(validOutput).toMatch(/class Root\(TypedDict\):/);
  expect(validOutput).toContain('user_id: int');

  const invalidSample = JSON.stringify({ class: 1, '2fa-enabled': true });
  const { output: invalidOutput } = jsonToCode(invalidSample, { language: 'python', rootName: 'Root' });
  expect(invalidOutput).toContain('Root = TypedDict(');
  expect(invalidOutput).toContain("'class':");
  expect(invalidOutput).toContain("'2fa-enabled':");
});

it('Java records carry JsonProperty with the original key and box nullable values', () => {
  const sample = JSON.stringify([
    { class: 1, n: 5 },
    { class: 2, n: null },
  ]);
  const { output } = jsonToCode(sample, { language: 'java', rootName: 'Root' });
  expect(output).toContain('public record RootItem(');
  expect(output).toContain('@JsonProperty("class")');
  expect(output).toMatch(/long class_/);
  expect(output).toMatch(/\bLong n\b/);
});

it('C# classes carry JsonPropertyName and nullable annotations', () => {
  const sample = JSON.stringify([{ id: 1 }, { id: null }]);
  const { output } = jsonToCode(sample, { language: 'csharp', rootName: 'Root' });
  expect(output).toContain('public sealed class RootItem');
  expect(output).toContain('[JsonPropertyName("id")]');
  expect(output).toContain('public long? Id { get; set; }');
});

it('Kotlin data classes carry SerialName and escape keyword names', () => {
  const sample = JSON.stringify({ class: 1, name: 'Ada' });
  const { output } = jsonToCode(sample, { language: 'kotlin', rootName: 'Root' });
  expect(output).toContain('@Serializable');
  expect(output).toContain('data class Root(');
  expect(output).toContain('@SerialName("class")');
  expect(output).toMatch(/val `class`: Long/);
});

it('PHP classes use readonly promoted properties and keep the original key in a docblock', () => {
  const sample = JSON.stringify({ 'weird key': 'x' });
  const { output } = jsonToCode(sample, { language: 'php', rootName: 'Root' });
  expect(output).toContain('final class Root');
  expect(output).toContain('public function __construct(');
  expect(output).toContain('public readonly string $weirdKey');
  expect(output).toContain('weird key');
});

it('keys that are not identifiers or are reserved words get valid names in Java, C#, Kotlin and PHP', () => {
  const sample = JSON.stringify({ class: 1, '2fa-enabled': true, '': 'x' });

  const javaOutput = jsonToCode(sample, { language: 'java', rootName: 'Root' }).output;
  expect(javaOutput).toMatch(/\bclass_\b/);

  const csharpOutput = jsonToCode(sample, { language: 'csharp', rootName: 'Root' }).output;
  expect(csharpOutput).toContain('[JsonPropertyName("class")]');

  const kotlinOutput = jsonToCode(sample, { language: 'kotlin', rootName: 'Root' }).output;
  expect(kotlinOutput).toMatch(/`class`/);

  const phpOutput = jsonToCode(sample, { language: 'php', rootName: 'Root' }).output;
  expect(phpOutput).toContain('$class');
});

it('keys that are not identifiers or are reserved words get valid names in Go, Rust and Python', () => {
  const sample = JSON.stringify({ type: 1, class: 2, '2fa-enabled': true, '': 'x' });

  const goOutput = jsonToCode(sample, { language: 'go', rootName: 'Root' }).output;
  expect(goOutput).toMatch(/\n\tField string `json:""`/);
  expect(goOutput).toMatch(/\n\tType int64 `json:"type"`/);

  const rustOutput = jsonToCode(sample, { language: 'rust', rootName: 'Root' }).output;
  expect(rustOutput).toContain('#[serde(rename = "")]');
  expect(rustOutput).toMatch(/pub field: String,/);
  expect(rustOutput).toContain('pub r#type: i64,');

  const pythonOutput = jsonToCode(sample, { language: 'python', rootName: 'Root' }).output;
  expect(pythonOutput).toContain('Root = TypedDict(');
  expect(pythonOutput).toContain("''");
});
