// Génère `public/icons/units-generated/` à partir des icônes de l'auteur (`public/icons/armament/`, jamais
// modifié) : chaque ton de vert remplaçable devient une des trois couleurs de remplacement, que la page remplacera
// par les tons d'unité du joueur (Docs/Design/09-Couleurs.md). Lancer après avoir changé une icône d'origine :
// npm run icons:units -w client

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PNG } from "pngjs";

const ICONS = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const SOURCE = join(ICONS, "armament");
const TARGET = join(ICONS, "units-generated");

/** Icônes des types de division : les 32 × 32, et les 16 × 16 qui ont les deux tailles. */
const FILES = [
  "armament-AA-32.png",
  "armament-AA-gun.png",
  "armament-AT-32.png",
  "armament-AT-gun.png",
  "armament-artillery-32.png",
  "armament-artillery.png",
  "armament-tankette.png",
  "icon-armament-SPAA-32.png",
  "icon-armament-armored-AT-32.png",
  "icon-armament-armored-SPART-32.png",
  "icon-armament-cruiser-tank-32.png",
  "icon-armament-infantry-tank-32.png",
  "icon-armament-medium-tank-32.png",
  "icon-armament-tankette-32.png",
  "icon-inf-elite.png",
  "icon-inf-milicia.png",
  "icon-inf-regulars.png",
] as const;

/** Couleurs de remplacement : ton foncé, moyen, clair. Aucune icône d'origine ne doit les contenir. */
const PLACEHOLDERS = [0xff00ff, 0x00ffff, 0x00ff00] as const;

/** Ton d'origine → indice dans `PLACEHOLDERS`. Trois familles de verts : chars et 16 px, pièces tractées, infanterie (sans ton clair). */
const TONES: ReadonlyMap<number, number> = new Map([
  [0x334636, 0],
  [0x47614b, 1],
  [0x648869, 2],
  [0x29341f, 0],
  [0x445632, 1],
  [0x65804a, 2],
  [0x1a4a20, 0],
  [0x24682d, 1],
]);

mkdirSync(TARGET, { recursive: true });

for (const file of FILES) {
  const png = PNG.sync.read(readFileSync(join(SOURCE, file)));
  const { data } = png;
  let replaced = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]!;
    if (alpha === 0) continue;
    if (alpha !== 255) throw new Error(`${file} : pixel semi-transparent, le remplacement exact des tons est impossible`);
    const rgb = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
    if ((PLACEHOLDERS as readonly number[]).includes(rgb)) throw new Error(`${file} : contient déjà une couleur de remplacement`);
    const tone = TONES.get(rgb);
    if (tone === undefined) continue;
    const placeholder = PLACEHOLDERS[tone]!;
    data[i] = placeholder >> 16;
    data[i + 1] = (placeholder >> 8) & 0xff;
    data[i + 2] = placeholder & 0xff;
    replaced++;
  }
  if (replaced === 0) throw new Error(`${file} : aucun ton remplacé`);
  writeFileSync(join(TARGET, file), PNG.sync.write(png));
  console.log(`${file} : ${replaced} pixels`);
}
