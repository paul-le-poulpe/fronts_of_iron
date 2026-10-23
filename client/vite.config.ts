import { defineConfig } from "vite";

// 01-Architecture §6, Client : le lobby est appelé par un chemin relatif
// (`/api/...`). En développement, Vite l'envoie à `wrangler dev` ; sur Cloudflare,
// c'est le Worker qui répond. Le mode solo n'appelle pas encore le lobby.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  worker: {
    format: "es",
  },
});
