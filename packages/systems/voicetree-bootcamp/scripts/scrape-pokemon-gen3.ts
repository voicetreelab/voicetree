#!/usr/bin/env tsx
// Scrape Gen 3 Pokémon (national pokedex 252-386) into per-pokemon markdown fixtures.
// Usage: pnpm tsx scripts/scrape-pokemon-gen3.ts [out-dir]
//
// Pure core:
//   - fetchPokemonData(id)   — IO, returns normalized PokemonData (or throws)
//   - formatMarkdown(data)   — pure, returns the markdown string
// Impure shell:
//   - bounded concurrency pool + per-id retry-once + file writes + summary

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GEN3_FIRST_ID = 252;
const GEN3_LAST_ID = 386;
const CONCURRENCY = 5;
const POKEAPI_BASE = "https://pokeapi.co/api/v2";

type StatName =
  | "hp"
  | "attack"
  | "defense"
  | "special-attack"
  | "special-defense"
  | "speed";

interface ApiPokemon {
  id: number;
  name: string;
  height: number; // decimeters
  weight: number; // hectograms
  types: { type: { name: string } }[];
  stats: { base_stat: number; stat: { name: string } }[];
}

interface ApiSpecies {
  flavor_text_entries: {
    flavor_text: string;
    language: { name: string };
  }[];
}

interface PokemonData {
  id: number;
  name: string;
  types: string[];
  hp: number;
  attack: number;
  defense: number;
  special_attack: number;
  special_defense: number;
  speed: number;
  height_m: number;
  weight_kg: number;
  flavorText: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return (await res.json()) as T;
}

function pickStat(stats: ApiPokemon["stats"], name: StatName): number {
  const entry = stats.find((s) => s.stat.name === name);
  if (!entry) {
    throw new Error(`PokéAPI response shape mismatch: missing stat "${name}"`);
  }
  return entry.base_stat;
}

function pickFirstEnglishFlavor(species: ApiSpecies): string {
  const entry = species.flavor_text_entries.find(
    (e) => e.language.name === "en",
  );
  if (!entry) {
    throw new Error("PokéAPI response shape mismatch: no English flavor text");
  }
  // PokéAPI flavor text contains form-feed, newline, and soft-hyphen artifacts
  // from the original game text rendering. Normalize to single-spaced prose.
  return entry.flavor_text.replace(/[\f\n\r­]+/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchPokemonData(id: number): Promise<PokemonData> {
  const [pokemon, species] = await Promise.all([
    fetchJson<ApiPokemon>(`${POKEAPI_BASE}/pokemon/${id}/`),
    fetchJson<ApiSpecies>(`${POKEAPI_BASE}/pokemon-species/${id}/`),
  ]);

  return {
    id: pokemon.id,
    name: pokemon.name,
    types: pokemon.types.map((t) => t.type.name),
    hp: pickStat(pokemon.stats, "hp"),
    attack: pickStat(pokemon.stats, "attack"),
    defense: pickStat(pokemon.stats, "defense"),
    special_attack: pickStat(pokemon.stats, "special-attack"),
    special_defense: pickStat(pokemon.stats, "special-defense"),
    speed: pickStat(pokemon.stats, "speed"),
    height_m: pokemon.height / 10,
    weight_kg: pokemon.weight / 10,
    flavorText: pickFirstEnglishFlavor(species),
  };
}

function titleCase(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatMarkdown(d: PokemonData): string {
  const title = titleCase(d.name);
  const typesYaml = d.types.map((t) => `  - ${t}`).join("\n");
  const typesList = d.types.map((t) => `- ${t}`).join("\n");
  return `---
id: ${d.id}
name: ${d.name}
types:
${typesYaml}
hp: ${d.hp}
attack: ${d.attack}
defense: ${d.defense}
special_attack: ${d.special_attack}
special_defense: ${d.special_defense}
speed: ${d.speed}
height_m: ${d.height_m}
weight_kg: ${d.weight_kg}
---
# ${title}

${d.flavorText}

## Types
${typesList}

## Stats
- HP: ${d.hp}
- Attack: ${d.attack}
- Defense: ${d.defense}
- Sp. Atk: ${d.special_attack}
- Sp. Def: ${d.special_defense}
- Speed: ${d.speed}
`;
}

async function withRetryOnce<T>(
  attempt: () => Promise<T>,
  label: string,
): Promise<T> {
  try {
    return await attempt();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[retry] ${label}: ${msg}`);
    return await attempt();
  }
}

async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

async function main(): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const defaultOut = resolve(scriptDir, "..", "fixtures", "pokemon-gen3");
  const outDir = process.argv[2] ? resolve(process.argv[2]) : defaultOut;

  await mkdir(outDir, { recursive: true });

  const ids: number[] = [];
  for (let i = GEN3_FIRST_ID; i <= GEN3_LAST_ID; i++) ids.push(i);

  const succeeded: number[] = [];
  const failed: { id: number; reason: string }[] = [];

  await runPool(ids, CONCURRENCY, async (id) => {
    try {
      const data = await withRetryOnce(() => fetchPokemonData(id), `id=${id}`);
      const filename = `${data.id}-${data.name}.md`;
      await writeFile(resolve(outDir, filename), formatMarkdown(data), "utf8");
      succeeded.push(id);
      if (succeeded.length % 25 === 0) {
        console.log(`  ${succeeded.length}/${ids.length} written`);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[fail] id=${id}: ${reason}`);
      failed.push({ id, reason });
    }
  });

  console.log(
    `\nDone. ${succeeded.length} succeeded, ${failed.length} failed.`,
  );
  console.log(`Output: ${outDir}`);
  if (failed.length > 0) {
    console.log("Failed ids:");
    for (const f of failed) console.log(`  ${f.id}: ${f.reason}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});
