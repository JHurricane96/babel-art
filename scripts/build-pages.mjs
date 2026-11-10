import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const destination = new URL('dist/', root);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const entry of ['index.html', 'style.css', 'simulator', 'renderer', 'shared']) {
  await cp(new URL(entry, root), new URL(entry, destination), { recursive: true });
}
await writeFile(new URL('.nojekyll', destination), '');
console.log(`Pages frontend ready: ${fileURLToPath(destination)}`);
