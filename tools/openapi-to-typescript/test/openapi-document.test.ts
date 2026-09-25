import { it, expect } from 'vitest';
import { readOpenApiDocument, OpenApiDocumentError } from '../src/openapi-document';

const JSON_DOC = `{
  "openapi": "3.0.4",
  "info": { "title": "t", "version": "1" },
  "paths": {
    "/pets": {
      "get": {
        "responses": { "200": { "description": "ok" } }
      }
    }
  }
}`;

const YAML_DOC = `openapi: 3.0.4
info:
  title: t
  version: "1"
paths:
  /pets:
    get:
      responses:
        "200":
          description: ok
`;

it('JSON and YAML documents give the same value and positions for the same pointer', () => {
  const jsonDoc = readOpenApiDocument(JSON_DOC, { format: 'json' });
  const yamlDoc = readOpenApiDocument(YAML_DOC, { format: 'yaml' });
  expect(jsonDoc.value).toEqual(yamlDoc.value);
  expect(jsonDoc.version).toBe('openapi-3.0');
  expect(yamlDoc.version).toBe('openapi-3.0');

  const jsonPos = jsonDoc.locate('/paths/~1pets/get/responses/200/description');
  const yamlPos = yamlDoc.locate('/paths/~1pets/get/responses/200/description');
  expect(jsonPos).toBeDefined();
  expect(yamlPos).toBeDefined();
});

it('a version field that is missing or unsupported is refused by name', () => {
  expect(() => readOpenApiDocument('{"info":{},"paths":{}}')).toThrow(OpenApiDocumentError);
  expect(() => readOpenApiDocument('{"info":{},"paths":{}}')).toThrow(/no "swagger" or "openapi" field/);

  expect(() => readOpenApiDocument('{"openapi":"4.0.0","info":{},"paths":{}}')).toThrow(OpenApiDocumentError);
  expect(() => readOpenApiDocument('{"openapi":"4.0.0","info":{},"paths":{}}')).toThrow(/"4\.0\.0"/);

  expect(() => readOpenApiDocument('{"swagger":"1.2","info":{},"paths":{}}')).toThrow(/"1\.2"/);
});

it('a YAML alias bomb is refused by the alias limit', () => {
  const lines = ['a: &a ["x","x","x","x","x","x","x","x","x","x"]'];
  for (let i = 0; i < 10; i++) {
    lines.push(`b${i}: &b${i} [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]`);
  }
  const bomb = `openapi: 3.0.4\ninfo: {}\npaths: {}\nx:\n${lines.map((l) => '  ' + l).join('\n')}\n`;
  expect(() => readOpenApiDocument(bomb, { format: 'yaml' })).toThrow(/YAML aliases that expand into too much data/);
});
