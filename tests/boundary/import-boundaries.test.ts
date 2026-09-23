import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Executable enforcement of the dependency rules (ARCH §11, TEST_SUITE_PLAN §19 R-A).
 * These are the checks that keep the layering honest as the codebase grows — a
 * violation fails the build here rather than being discovered many phases later.
 */

const SRC_ROOT = join(process.cwd(), 'src');

function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function readSource(file: string): string {
  return readFileSync(file, 'utf8');
}

/** Removes block and whole-line comments so prose never trips a boundary rule. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier) specifiers.push(specifier);
    }
  }
  return specifiers;
}

/**
 * Value imports only: `import type ...` disappears at compile time and cannot create
 * a runtime cross-layer dependency — the same reasoning that already exempts
 * type-only core imports in the ports rule. A mixed import (`{ vec3, type Vec3 }`)
 * is a value import, because the module is loaded at runtime.
 */
function valueImportSpecifiers(source: string): string[] {
  const withoutTypeImports = source.replace(
    /^[ \t]*import\s+type\s+[^;]*?['"][^'"]+['"];?/gm,
    ''
  );
  return importSpecifiers(withoutTypeImports);
}

function layerFiles(layer: string): string[] {
  return listTsFiles(join(SRC_ROOT, layer));
}

function forbiddenImportsIn(
  layer: string,
  forbiddenFragments: readonly string[],
  allowTypeOnlyFrom: readonly string[] = []
): string[] {
  const violations: string[] = [];
  for (const file of layerFiles(layer)) {
    const source = stripAllowedTypeImports(readSource(file), allowTypeOnlyFrom);
    for (const specifier of importSpecifiers(source)) {
      for (const fragment of forbiddenFragments) {
        if (specifier === fragment || specifier.includes(fragment)) {
          violations.push(`${relative(SRC_ROOT, file)} imports "${specifier}"`);
        }
      }
    }
  }
  return violations;
}

/**
 * Type-only imports compile away — they carry zero runtime dependency, so a
 * port may reference a core *type* (e.g. `Vec3`) without breaking R4's
 * "interfaces only, no logic" contract. Value imports still fail.
 */
function stripAllowedTypeImports(source: string, allowed: readonly string[]): string {
  let out = source;
  for (const fragment of allowed) {
    const pattern = new RegExp(
      `^import\\s+type\\s[^;]*from\\s+['"][^'"]*${fragment.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}[^'"]*['"];?[ \\t]*$`,
      'gm'
    );
    out = out.replace(pattern, '');
  }
  return out;
}

describe('dependency boundaries — layer rules', () => {
  it('scans the source tree it is meant to protect', () => {
    expect(layerFiles('core').length).toBeGreaterThanOrEqual(3);
    expect(layerFiles('ports').length).toBeGreaterThanOrEqual(1);
    expect(layerFiles('adapters').length).toBeGreaterThanOrEqual(2);
  });

  it('src/core has no engine, port, or upper-layer imports (R1/R2)', () => {
    const violations = forbiddenImportsIn('core', [
      'three',
      '/ports/',
      '/game-state/',
      '/gameplay/',
      '/adapters/',
      '/presentation/',
      '/debug/'
    ]);
    expect(violations).toEqual([]);
  });

  it('src/core contains no direct DOM or storage access (R2)', () => {
    const forbiddenTokens = ['window.', 'document.', 'localStorage', 'navigator.', 'requestAnimationFrame'];
    const violations: string[] = [];

    for (const file of layerFiles('core')) {
      const source = stripComments(readSource(file));
      for (const token of forbiddenTokens) {
        if (source.includes(token)) {
          violations.push(`${relative(SRC_ROOT, file)} references "${token}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('src/ports declares interfaces only — no engine, adapter, or logic imports (R4)', () => {
    // Type-only imports of core math types are permitted: they compile away,
    // so a port stays logic-free while sharing the Vec3 structural type.
    const violations = forbiddenImportsIn(
      'ports',
      [
        'three',
        '/adapters/',
        '/gameplay/',
        '/presentation/',
        '/game-state/',
        '/core/'
      ],
      ['/core/']
    );
    expect(violations).toEqual([]);
  });

  it('src/adapters never drives logical state (L4 -> L1 is forbidden)', () => {
    const violations = forbiddenImportsIn('adapters', ['/game-state/', '/gameplay/']);
    expect(violations).toEqual([]);
  });

  it('src/game-state (when it exists) is engine-free and headless', () => {
    const files = layerFiles('game-state');
    if (files.length === 0) {
      // Not created yet (Phase 1 scope). The rule activates automatically in Phase 6.
      return;
    }
    const violations = forbiddenImportsIn('game-state', [
      'three',
      '/ports/',
      '/gameplay/',
      '/adapters/',
      '/presentation/'
    ]);
    expect(violations).toEqual([]);
  });
});

describe('dependency boundaries — composition root containment', () => {
  it('only the composition roots may import across nearly every layer', () => {
    const compositionRoots = new Set(['main.ts', 'app.ts']);
    const crossLayerUsers: string[] = [];

    for (const file of listTsFiles(SRC_ROOT)) {
      const name = relative(SRC_ROOT, file).replace(/\\/g, '/');
      const specifiers = valueImportSpecifiers(readSource(file));
      const distinctLayers = new Set(
        specifiers
          .filter((specifier) => specifier.startsWith('../') || specifier.startsWith('./'))
          .map((specifier) => {
            const segments = specifier.split('/').filter((segment) => segment === 'core' || segment === 'ports' || segment === 'adapters' || segment === 'gameplay' || segment === 'presentation' || segment === 'debug' || segment === 'game-state' || segment === 'data' || segment === 'levels' || segment === 'ui');
            return segments[segments.length - 1] ?? '';
          })
      );

      if (distinctLayers.size >= 3 && !compositionRoots.has(name)) {
        crossLayerUsers.push(`${name} spans ${distinctLayers.size} layers`);
      }
    }

    expect(crossLayerUsers).toEqual([]);
  });

  it('only L4 and the composition roots may import adapters (ARCH §11)', () => {
    // Stronger than the span heuristic above and it counts *type-only* imports too:
    // L1/L2 must depend on ports, never on the engine-touching implementations
    // (rule R4 "everything engine-touching sits behind a port").
    const compositionRoots = new Set(['main.ts', 'app.ts']);
    const violators: string[] = [];

    for (const file of listTsFiles(SRC_ROOT)) {
      const name = relative(SRC_ROOT, file).replace(/\\/g, '/');
      if (compositionRoots.has(name) || name.startsWith('adapters/')) continue;
      for (const specifier of importSpecifiers(readSource(file))) {
        if (specifier.includes('/adapters/')) violators.push(`${name} imports ${specifier}`);
      }
    }

    expect(violators).toEqual([]);
  });
});