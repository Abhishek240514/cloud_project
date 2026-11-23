export const WIDTH = 1440;
export const HEIGHT = 900;
export function paint(canvas, elements) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  for (const item of elements) {
    ctx.fillStyle = item.color;
    ctx.strokeStyle = item.tool === "eraser" ? "#ffffff" : item.color;
    ctx.lineWidth = item.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (item.tool === "text") {
      ctx.font = `${item.width}px system-ui`;
      ctx.fillText(item.text, item.x, item.y);
      continue;
    }
    ctx.beginPath();
    item.points.forEach(([x, y], i) =>
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y),
    );
    if (item.points.length === 1) {
      const [x, y] = item.points[0];
      ctx.lineTo(x + 0.1, y);
    }
    ctx.stroke();
  }
}
