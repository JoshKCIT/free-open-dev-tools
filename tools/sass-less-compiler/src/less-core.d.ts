/**
 * Less's published package types only its stock entry points, and those fetch files and addresses and need a browser
 * window or Node. This folder builds Less from its core factory instead (`less/lib/less/index.js`, see
 * less-engine.ts for why), which has no types of its own. This declaration gives the few members less-engine.ts uses,
 * and nothing else, so the standalone type-check of this folder passes without a suppressed error.
 */
declare module 'less/lib/less/index.js' {
  /** A value a Less function receives: a node of the parse tree. Only a quoted string's text is read. */
  export interface LessNode {
    value?: unknown;
  }

  /** The environment the factory is given in place of the Node or browser one. */
  export interface LessEnvironment {
    encodeBase64: (text: string) => string;
    mimeLookup: (path: string) => string;
    charsetLookup: (mime: string) => string;
    getSourceMapGenerator: () => unknown;
  }

  export interface LessInstance {
    /** The version this instance was built with, as major, minor and patch. */
    version: number[];
    /** Base class of a file manager; the factory hands it out so a subclass can be written. */
    AbstractFileManager: new () => object;
    /** Base class of a plugin loader. */
    AbstractPluginLoader: new () => object;
    /** The constructor Less calls, with this instance, to make its plugin loader. */
    PluginLoader: unknown;
    /** The constructor of the file manager. */
    FileManager: unknown;
    functions: {
      functionRegistry: {
        add: (name: string, implementation: (...args: LessNode[]) => unknown) => void;
      };
    };
    render: (source: string, options: Record<string, unknown>) => Promise<{ css: string }>;
  }

  export default function createLess(
    environment: LessEnvironment,
    fileManagers: object[],
    version: string,
  ): LessInstance;
}
