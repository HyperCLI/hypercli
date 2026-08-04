import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function importDeclarationHasRuntimeBinding(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  if (!clause.namedBindings) return false;
  if (ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings.elements.some((element) => !element.isTypeOnly);
}

function exportDeclarationHasRuntimeBinding(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return false;
  if (!node.exportClause) return true;
  if (!ts.isNamedExports(node.exportClause)) return true;
  return node.exportClause.elements.some((element) => !element.isTypeOnly);
}

function runtimeModuleSpecifiers(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      importDeclarationHasRuntimeBinding(node)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      exportDeclarationHasRuntimeBinding(node)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

async function browserRuntimeGraph(entry: string): Promise<{
  files: Set<string>;
  nodeBuiltins: Set<string>;
}> {
  const files = new Set<string>();
  const nodeBuiltins = new Set<string>();

  const visit = async (fileName: string): Promise<void> => {
    if (files.has(fileName)) return;
    files.add(fileName);
    const source = await readFile(fileName, 'utf8');
    for (const specifier of runtimeModuleSpecifiers(source, fileName)) {
      if (specifier.startsWith('node:')) {
        nodeBuiltins.add(specifier);
        continue;
      }
      if (!specifier.startsWith('.')) continue;
      const sourceSpecifier = specifier.replace(/\.js$/, '.ts');
      await visit(resolve(dirname(fileName), sourceSpecifier));
    }
  };

  await visit(entry);
  return { files, nodeBuiltins };
}

describe('browser entry', () => {
  it('does not pull Node-only deployment modules into browser bundles', async () => {
    const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
    const graph = await browserRuntimeGraph(resolve(sourceRoot, 'browser.ts'));

    expect([...graph.nodeBuiltins]).toEqual([]);
    expect(graph.files.has(resolve(sourceRoot, 'agents.ts'))).toBe(false);
    expect(graph.files.has(resolve(sourceRoot, 'agent.ts'))).toBe(true);
    expect(graph.files.has(resolve(sourceRoot, 'agent-slots.ts'))).toBe(true);
  });
});
