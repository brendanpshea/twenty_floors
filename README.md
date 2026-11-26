# Twenty Floors

An open-source, turn-based dungeon crawler for the browser. Create a hero,
descend twenty procedurally generated floors, and fight monsters from the
D&D System Reference Document 5.2. Each floor you clear is a level gained.

Built with [three.js](https://threejs.org/) and TypeScript. Runs as a static
site, on laptops and tablets.

**Status:** early development. The first milestone is a three-floor vertical
slice with one class (Fighter, levels 1 to 3).

## Development

Requires Node 20 or newer.

```sh
npm install
npm run dev        # start the dev server
npm test           # run the unit tests
npm run typecheck  # type-check the project
npm run build      # production build into dist/
```

Preview pages for working on one module in isolation (with the dev server running):

- `/dev/render-preview.html`: the 3D renderer on fixture floors
- `/dev/ui-preview.html`: every UI screen with mock data

## How it is organised

See [docs/DESIGN.md](docs/DESIGN.md) for the design, the module map and the
conventions. The short version: `src/rules` (headless rules engine) and
`src/gen` (headless floor generation) know nothing about the browser;
`src/render` (three.js) and `src/ui` (DOM) know nothing about rules; `src/game`
wires them together through the contracts in `src/core/types.ts`.

## Licenses

- Code: MIT, see [LICENSE](LICENSE).
- Rules content: includes material from the System Reference Document 5.2.1 by
  Wizards of the Coast LLC, licensed under CC-BY-4.0.
- Art: CC0 and CC-BY assets. Every asset is listed with its author and license
  in [CREDITS.md](CREDITS.md).

Twenty Floors is not affiliated with, endorsed, sponsored, or approved by
Wizards of the Coast.
