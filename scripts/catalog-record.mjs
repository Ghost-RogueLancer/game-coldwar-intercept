import ts from "typescript";
import { readFileSync } from "node:fs";

// Read only literal data, without importing browser-only catalog dependencies.
// The AST accepts normal TypeScript formatting, quoted keys and numeric syntax.
export function readCatalogRecord(url, catalogName, id) {
  const source = ts.createSourceFile(String(url), readFileSync(url, "utf8"), ts.ScriptTarget.Latest, true);
  let catalog;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === catalogName) catalog = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  const key = node => ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node) ? node.text : undefined;
  const fail = node => { throw new Error(`Expected literal ${catalogName}[${JSON.stringify(id)}] in ${url}${node ? `; unsupported ${ts.SyntaxKind[node.kind]} at ${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}` : ""}`); };
  function literal(node) {
    if (!node) return fail();
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
      if (node.operator === ts.SyntaxKind.MinusToken) return -Number(node.operand.text);
      if (node.operator === ts.SyntaxKind.PlusToken) return Number(node.operand.text);
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
    if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(property => {
      if (!ts.isPropertyAssignment(property) || key(property.name) === undefined) return fail(property);
      return [key(property.name), literal(property.initializer)];
    }));
    return fail(node);
  }
  if (!catalog || !ts.isObjectLiteralExpression(catalog)) return fail();
  const entry = catalog.properties.find(property => ts.isPropertyAssignment(property) && key(property.name) === id);
  return literal(entry?.initializer);
}
