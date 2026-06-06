// Чтение Anvil-региона (.mca).
//
// Формат файла:
//   - 4096 байт  — таблица локаций (1024 записи по 4 байта:
//                  3 байта смещение в секторах по 4 КБ + 1 байт длина в секторах)
//   - 4096 байт  — таблица таймстампов (нам не нужна)
//   - далее      — чанки. Каждый чанк: 4 байта длина (BE) + 1 байт тип сжатия + данные.
//                  тип сжатия: 1 = gzip, 2 = zlib(deflate), 3 = без сжатия.
//
// prismarine-nbt.parse сам определяет gzip/zlib, поэтому отдаём ему сырые сжатые байты.

import { readFile } from "node:fs/promises";
import { inflateSync, gunzipSync } from "node:zlib";
import nbt from "prismarine-nbt";

const SECTOR = 4096;

// Координаты региона из имени файла r.X.Z.mca
export function parseRegionName(fileName) {
  const m = /^r\.(-?\d+)\.(-?\d+)\.mca$/.exec(fileName);
  if (!m) return null;
  return { regionX: Number(m[1]), regionZ: Number(m[2]) };
}

// Имя файла региона, в котором лежит чанк (chunkX, chunkZ)
export function regionFileForChunk(chunkX, chunkZ) {
  return `r.${chunkX >> 5}.${chunkZ >> 5}.mca`;
}

// Читает все чанки региона и возвращает массив { chunkX, chunkZ, nbt }
// где nbt — упрощённый объект (nbt.simplify).
export async function readRegion(filePath, regionX, regionZ) {
  let buf;
  try {
    buf = await readFile(filePath);
  } catch {
    return []; // файла нет — регион не сгенерирован
  }
  if (buf.length < SECTOR * 2) return [];

  const chunks = [];
  for (let i = 0; i < 1024; i++) {
    const entryOffset = i * 4;
    const sectorOffset =
      (buf[entryOffset] << 16) | (buf[entryOffset + 1] << 8) | buf[entryOffset + 2];
    const sectorCount = buf[entryOffset + 3];
    if (sectorOffset === 0 || sectorCount === 0) continue; // чанк отсутствует

    const start = sectorOffset * SECTOR;
    if (start + 5 > buf.length) continue;

    const length = buf.readUInt32BE(start); // длина данных + байт типа сжатия
    const compression = buf[start + 4];
    const dataStart = start + 5;
    const dataEnd = dataStart + (length - 1);
    if (dataEnd > buf.length) continue;
    const raw = buf.subarray(dataStart, dataEnd);

    let decompressed;
    try {
      if (compression === 1) decompressed = gunzipSync(raw);
      else if (compression === 2) decompressed = inflateSync(raw);
      else if (compression === 3) decompressed = raw;
      else continue; // неизвестный/внешний тип сжатия — пропускаем
    } catch {
      continue;
    }

    let parsed;
    try {
      parsed = await nbt.parse(decompressed);
    } catch {
      continue;
    }
    const data = nbt.simplify(parsed.parsed);

    // индекс -> локальные координаты чанка
    const localX = i % 32;
    const localZ = (i / 32) | 0;
    chunks.push({
      chunkX: regionX * 32 + localX,
      chunkZ: regionZ * 32 + localZ,
      nbt: data,
    });
  }
  return chunks;
}
