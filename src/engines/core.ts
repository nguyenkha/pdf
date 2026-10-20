export const ENGINE_BASE = "/engine/ghostscript-10.08.0-0.7.2/";
export interface GhostscriptCore {
  FS: {
    writeFile(path: string, bytes: Uint8Array): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
  };
  callMain(args: string[]): number;
  getHeapBytes(): number;
}
export type CoreFactory = (options: {
  wasmBinary: Uint8Array;
  print: (line: string) => void;
  printErr: () => void;
}) => Promise<GhostscriptCore>;
