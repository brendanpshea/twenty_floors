// Just enough of Node for the smoke test (the project does not depend on @types/node).
declare module 'node:fs' {
  export function readFileSync(path: URL | string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string): void;
}
declare const process: { env: Record<string, string | undefined> };
