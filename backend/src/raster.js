import { PNG } from "pngjs";
// Pure JS rasterization keeps Lambda deployment portable across CPU platforms.
export function boardPng(elements) {
  const image = new PNG({ width: 720, height: 450 });
  image.data.fill(255);
  function dot(x, y, r, color) {
    for (
      let py = Math.max(0, Math.floor(y - r));
      py <= Math.min(449, Math.ceil(y + r));
      py++
    )
      for (
        let px = Math.max(0, Math.floor(x - r));
        px <= Math.min(719, Math.ceil(x + r));
        px++
      )
        if ((px - x) ** 2 + (py - y) ** 2 <= r * r) {
          const offset = (py * 720 + px) * 4;
          image.data[offset] = color[0];
          image.data[offset + 1] = color[1];
          image.data[offset + 2] = color[2];
        }
  }
  for (const e of elements) {
    if (e.tool === "text") continue;
    const color =
      e.tool === "eraser"
        ? [255, 255, 255]
        : [1, 3, 5].map((i) => parseInt(e.color.slice(i, i + 2), 16));
    const radius = Math.max(0.7, e.width / 4),
      points = e.points.map(([x, y]) => [x / 2, y / 2]);
    dot(...points[0], radius, color);
    for (let i = 1; i < points.length; i++) {
      const [x, y] = points[i - 1],
        [endX, endY] = points[i];
      const steps = Math.ceil(Math.max(Math.abs(endX - x), Math.abs(endY - y)));
      for (let n = 1; n <= steps; n++)
        dot(
          x + ((endX - x) * n) / steps,
          y + ((endY - y) * n) / steps,
          radius,
          color,
        );
    }
  }
  return PNG.sync.write(image).toString("base64");
}
