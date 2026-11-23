import { build } from "esbuild";
await build({
  entryPoints: ["backend/src/socket.js", "backend/src/summary.js"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outdir: ".aws-sam/build/handlers",
  outExtension: { ".js": ".cjs" },
  sourcemap: true,
});
console.log("Lambda bundles built in .aws-sam/build/handlers");
