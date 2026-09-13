import { defineConfig } from "vite";

export default defineConfig({
  // Discord serves the Activity through its proxy. Relative asset URLs survive
  // that without knowing the mapped path.
  base: "",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
