import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const packages = {
  ghostscript: 'node_modules/@wasm-zoo/ghostscript',
  pdfjs: 'node_modules/pdfjs-dist', react: 'node_modules/react',
  'react-dom': 'node_modules/react-dom', lucide: 'node_modules/lucide-react',
  scheduler: path.dirname(require.resolve('scheduler/package.json', { paths: [fs.realpathSync('node_modules/react-dom')] })),
};
for (const [name, source] of Object.entries(packages)) {
  const destination = `dist/licenses/${name}`;
  fs.mkdirSync(destination, { recursive: true });
  const entries = fs.readdirSync(source).filter(entry => /^(LICENSE|COPYING|NOTICE|THIRD-PARTY-LICENSES)/i.test(entry));
  if (!entries.length) throw new Error(`${name} license notices missing`);
  for (const entry of entries) fs.cpSync(path.join(source, entry), path.join(destination, entry), { recursive: true });
}
fs.copyFileSync('THIRD_PARTY_NOTICES.md', 'dist/licenses/THIRD_PARTY_NOTICES.md');
