/**
 * Minimal ambient types for the `libheif-js/wasm-bundle` subpath.
 *
 * `libheif-js` ships a `.d.ts` for its low-level Emscripten bindings
 * (`libheif-wasm/libheif.d.ts`), but the package has no `"exports"` map and
 * no `"types"` field pointing bundler-style subpath imports at it, so
 * `import("libheif-js/wasm-bundle")` resolves with no types at all. This
 * covers only the surface src/lib/heic-decode.ts actually calls — verified
 * against the real 1.19.8 tarball in a scratch install (see DECISION-039
 * and docs/work-log/2026-07-21-heic-modern-iphone-decode.md), not trusted
 * from the README alone.
 */
declare module "libheif-js/wasm-bundle" {
  /** Matches the browser `ImageData` shape libheif-js's `display()` fills in. */
  interface HeifDisplayTarget {
    data: Uint8ClampedArray;
    width: number;
    height: number;
  }

  export class HeifImage {
    get_width(): number;
    get_height(): number;
    /**
     * Callback-based, not Promise-based: fires with `target` (mutated in
     * place) on success, or a falsy value on failure — per libheif-js's own
     * README usage sample.
     */
    display(
      target: HeifDisplayTarget,
      callback: (result: HeifDisplayTarget | null | false) => void,
    ): void;
    /** Releases the underlying WASM image handle. */
    free(): void;
  }

  export class HeifDecoder {
    /** One HeifImage per top-level image in the container; `[]` on any decode failure. */
    decode(bytes: Uint8Array): HeifImage[];
  }

  interface LibheifModule {
    HeifDecoder: typeof HeifDecoder;
  }

  /**
   * `module.exports = require('./libheif-wasm/libheif-bundle.js')()` — an
   * already-invoked Emscripten MODULARIZE factory, so this entry point's
   * default export is normally a Promise of the module namespace rather
   * than a callable factory. Typed loosely (both shapes) because bundler
   * CJS interop is what actually produces the value at runtime, not this
   * declaration — see resolveLibheifModule in heic-decode.ts, which handles
   * both shapes explicitly.
   */
  const libheifModule: Promise<LibheifModule> | (() => Promise<LibheifModule>);
  export default libheifModule;
}
