// node --import ./test/register.mjs … : resolves "@/…" and swaps the npm packages for local stand-ins.
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);
