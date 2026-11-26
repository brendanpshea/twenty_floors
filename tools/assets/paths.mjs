// Shared path constants. Scripts live in tools/assets/, two levels below the repo root.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const TOOLS=path.dirname(fileURLToPath(import.meta.url))+'/';
export const ROOT=path.resolve(TOOLS,'../..').split(path.sep).join('/')+'/';
export const SRC=ROOT+'assets-src/';          // downloaded packs + scratch (git-ignored)
export const BASE=SRC+'base/';                 // intermediate base models (git-ignored)
export const MODELS=ROOT+'public/assets/models/';
export const MANIFEST=ROOT+'public/assets/manifest.json';
