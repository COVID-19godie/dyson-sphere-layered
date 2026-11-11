/**
 * 全画幅（36×24mm）焦段表。
 * three 的 PerspectiveCamera.fov 是**垂直**视场角，换算：vfov = 2·atan(12 / f)。
 * 镜头脚本只写焦段名，不写 fov 数字——改构图时不用回算。
 */
export const LENSES = {
  '24mm': { fov: 53.13, note: '巨构全貌 / 空间压迫' },
  '28mm': { fov: 46.40, note: '原型默认值' },
  '35mm': { fov: 37.85, note: '叙事主镜头' },
  '50mm': { fov: 26.99, note: '中景' },
  '85mm': { fov: 16.07, note: '特写 / 压缩空间' },
};

export const LENS_NAMES = Object.keys(LENSES);

/**
 * 支持单焦段或 [起, 止] 双焦段。返回 [from, to] 便于插值。
 */
export function lensFov(v) {
  if (typeof v === 'number') return [v, v];
  const a = Array.isArray(v) ? v[0] : v;
  const b = Array.isArray(v) ? v[1] : v;
  return [
    (LENSES[a] || LENSES['35mm']).fov,
    (LENSES[b] || LENSES['35mm']).fov,
  ];
}
