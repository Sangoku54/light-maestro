const fs = require("fs");
const p = "electron/remote/server.ts";
let s = fs.readFileSync(p, "utf8");
const marker = "const REMOTE_PAGE_HTML = ";
const a = s.indexOf(marker);
if (a < 0) throw new Error("marker introuvable");
const html = s.slice(a + marker.length + 1, s.lastIndexOf("`;"));
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error("script introuvable");
const script = m[1];
fs.writeFileSync("electron/remote/_script.tmp.js", script, "utf8");
console.log("script extrait, taille=" + script.length);
try { new Function(script); console.log("SYNTAX OK"); } catch(e) { console.log("SYNTAX ERROR:", e.message); }
