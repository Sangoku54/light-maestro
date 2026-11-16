const fs = require("fs");
const p = "electron/remote/server.ts";
let s = fs.readFileSync(p, "utf8");
const marker = "const REMOTE_PAGE_HTML = ";
const a = s.indexOf(marker);
if (a < 0) throw new Error("marker introuvable");
const html = s.slice(a + marker.length + 1, s.lastIndexOf("`;"));
fs.writeFileSync("electron/remote/_page.tmp.html", html, "utf8");
console.log("extrait, taille=" + html.length);
