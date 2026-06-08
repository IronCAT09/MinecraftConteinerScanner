// Сканер контейнеров Minecraft 1.18+.
// Несколько миров (у каждого свой каталог регионов и свои кубоиды).
// Находит контейнеры внутри кубоидов, рекурсивно раскрывает шалкеры,
// считает суммарное количество предметов и количество полных шалкеров.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { outFile, worlds, FULL_SHULKER_COUNTS } from "./config.js";
import { readRegion, regionFileForChunk } from "./region.js";

// --- нормализация кубоида -> min/max по каждой оси ---
function normalize(dim) {
  const { pos1, pos2 } = dim;
  return {
    name: dim.name ?? "unnamed",
    min: {
      x: Math.min(pos1.x, pos2.x),
      y: Math.min(pos1.y, pos2.y),
      z: Math.min(pos1.z, pos2.z),
    },
    max: {
      x: Math.max(pos1.x, pos2.x),
      y: Math.max(pos1.y, pos2.y),
      z: Math.max(pos1.z, pos2.z),
    },
  };
}

function inside(box, x, y, z) {
  return (
    x >= box.min.x && x <= box.max.x &&
    y >= box.min.y && y <= box.max.y &&
    z >= box.min.z && z <= box.max.z
  );
}

// --- работа с предметами (поддержка форматов до и после 1.20.5) ---
function itemId(item) {
  return item.id ?? "unknown";
}

function itemCount(item) {
  return item.Count ?? item.count ?? 1;
}

function isShulker(id) {
  return typeof id === "string" && id.replace(/^minecraft:/, "").endsWith("shulker_box");
}

// Вложенные предметы (содержимое шалкера-предмета и т.п.)
function nestedItems(item) {
  // 1.18 - 1.20.4: tag.BlockEntityTag.Items
  const tagItems = item?.tag?.BlockEntityTag?.Items;
  if (Array.isArray(tagItems)) return tagItems;

  // 1.20.5+ компоненты: components["minecraft:container"] = [{slot, item}, ...]
  const container = item?.components?.["minecraft:container"];
  if (Array.isArray(container)) {
    return container.map((e) => e.item).filter(Boolean);
  }
  return null;
}

// Полный ли это шалкер: один вид предмета и количество = 1728/864.
// Возвращает id содержимого, если шалкер полный, иначе null.
function fullShulkerItem(item) {
  if (!isShulker(itemId(item))) return null;
  const nested = nestedItems(item);
  if (!Array.isArray(nested) || nested.length === 0) return null;

  const ids = new Set(nested.map(itemId));
  if (ids.size !== 1) return null; // больше одного вида предмета

  const total = nested.reduce((s, i) => s + itemCount(i), 0);
  if (!FULL_SHULKER_COUNTS.includes(total)) return null;

  return itemId(nested[0]);
}

// Рекурсивно складывает предметы в totals (id -> count)
// и фиксирует полные шалкеры в fullShulkers (id содержимого -> count).
function collectItems(items, totals, fullShulkers) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    const id = itemId(item);
    totals[id] = (totals[id] ?? 0) + itemCount(item);

    if (isShulker(id)) {
      const fullOf = fullShulkerItem(item);
      if (fullOf) fullShulkers[fullOf] = (fullShulkers[fullOf] ?? 0) + 1;
    }

    const nested = nestedItems(item);
    if (nested) collectItems(nested, totals, fullShulkers); // содержимое шалкера
  }
}

// Список контейнеров чанка (block_entities с массивом Items)
function containersInChunk(chunkNbt) {
  const list =
    chunkNbt.block_entities ??
    chunkNbt.Level?.TileEntities ??
    chunkNbt.TileEntities ??
    [];
  return list.filter((be) => Array.isArray(be.Items));
}

// Какие файлы регионов нужны для набора кубоидов
function regionsNeeded(boxes) {
  const set = new Set();
  for (const box of boxes) {
    const cx0 = box.min.x >> 4, cx1 = box.max.x >> 4;
    const cz0 = box.min.z >> 4, cz1 = box.max.z >> 4;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        set.add(regionFileForChunk(cx, cz));
      }
    }
  }
  return [...set];
}

function addInto(target, source) {
  for (const [id, c] of Object.entries(source)) {
    target[id] = (target[id] ?? 0) + c;
  }
}

async function scanWorld(world) {
  const boxes = world.dimensions.map(normalize);
  const results = boxes.map((box) => ({
    name: box.name,
    totals: {},
    fullShulkers: {},
  }));

  if (boxes.length === 0) {
    console.warn(`[world ${world.name}] кубоиды не заданы — пропуск`);
    return { name: world.name, regionDir: world.regionDir, dimensions: results, totals: {}, fullShulkers: {} };
  }

  for (const file of regionsNeeded(boxes)) {
    const started = performance.now();
    const fullPath = path.join(world.regionDir, file);
    const m = /^r\.(-?\d+)\.(-?\d+)\.mca$/.exec(file);
    const [regionX, regionZ] = [Number(m[1]), Number(m[2])];

    const chunks = await readRegion(fullPath, regionX, regionZ);
    if (chunks.length === 0) {
      console.warn(`[${world.name}] [skip] ${file} — нет данных`);
      continue;
    }

    for (const chunk of chunks) {
      for (const be of containersInChunk(chunk.nbt)) {
        const { x, y, z } = be;
        for (let i = 0; i < boxes.length; i++) {
          if (!inside(boxes[i], x, y, z)) continue;

          collectItems(be.Items, results[i].totals, results[i].fullShulkers);
        }
      }
    }
    const ms = (performance.now() - started).toFixed(1);
    console.log(`[${world.name}] [ok] ${file} — ${ms} мс`);
  }

  // итог по миру
  const worldTotals = {};
  const worldFull = {};
  for (const r of results) {
    addInto(worldTotals, r.totals);
    addInto(worldFull, r.fullShulkers);
  }

  return {
    name: world.name,
    regionDir: world.regionDir,
    dimensions: results,
    totals: worldTotals,
    fullShulkers: worldFull,
  };
}

async function main() {
  const startedAll = performance.now();
  const worldResults = [];
  for (const world of worlds) {
    worldResults.push(await scanWorld(world));
  }

  // общий итог по всем мирам
  const grandTotals = {};
  const grandFullShulkers = {};
  for (const w of worldResults) {
    addInto(grandTotals, w.totals);
    addInto(grandFullShulkers, w.fullShulkers);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    worlds: worldResults,
    grandTotals,
    grandFullShulkers,
  };

  await writeFile(outFile, JSON.stringify(output, null, 2), "utf8");

  const itemKinds = Object.keys(grandTotals).length;
  const fullShulkerCount = Object.values(grandFullShulkers).reduce((a, b) => a + b, 0);
  const totalMs = (performance.now() - startedAll).toFixed(1);
  console.log(
    `\nГотово. Миров: ${worldResults.length}, видов предметов: ${itemKinds}, полных шалкеров: ${fullShulkerCount}.`
  );
  console.log(`Общее время обработки: ${totalMs} мс`);
  console.log(`Записано в ${outFile}`);
}

main().catch((e) => {
  console.error("Ошибка:", e);
  process.exit(1);
});
