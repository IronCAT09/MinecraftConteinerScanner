// Настройки сканера.
//
// outFile — куда писать результат.
//
// worlds — список миров. У каждого мира свой каталог с регионами
//          (имена r.X.Z.mca в разных мирах могут совпадать — поэтому
//          регионы привязаны к миру) и свой набор кубоидов.
//
// Кубоид: name + два угла pos1 и pos2 (порядок не важен).

export const outFile = "./containers.json";

export const worlds = [
  {
    name: "world",
    regionDir: "./worlds/world/region",
    dimensions: [
      // наш склад
      {
        name: "Склад",
        pos1: { x: 100, y: -60, z: 100 },
        pos2: { x: 140, y: 20, z: 140 },
      },
      // склад шерсти
      {
        name: "Склад шерсти",
        pos1: { x: 200, y: -60, z: -50 },
        pos2: { x: 230, y: 30, z: -10 },
      },
    ],
  },
  {
    name: "world_nether",
    regionDir: "./worlds/world_nether/DIM-1/region",
    dimensions: [
      // {
      //   name: "Склад в аду",
      //   pos1: { x: 0, y: 0, z: 0 },
      //   pos2: { x: 32, y: 64, z: 32 },
      // },
    ],
  },
  // ... другие миры
];

// Размеры "полного" шалкера (27 слотов): максимальный стак * 27.
// 64 * 27 = 1728 (обычные предметы), 32 * 27 = 864.
export const FULL_SHULKER_COUNTS = [1728, 864];
