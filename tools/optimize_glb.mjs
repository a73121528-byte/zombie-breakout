import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, quantize } from '@gltf-transform/functions';
const [,, inp, out, mode] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
const seen = new Set();
for (const a of doc.getRoot().listAnimations()) {
  const n = a.getName().split('|').pop();
  if (seen.has(n)) { a.dispose(); continue; }
  seen.add(n); a.setName(n);
}
const steps = [dedup(), prune({keepLeaves:true}), resample()];
if (mode !== 'noq') steps.push(quantize({ quantizePosition: 14, quantizeNormal: 10 }));
await doc.transform(...steps);
await io.write(out, doc);
