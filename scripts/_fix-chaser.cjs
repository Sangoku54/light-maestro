const fs = require("fs");
const p = "electron/remote/_page.tmp.html";
let s = fs.readFileSync(p, "utf8");

// Trouver le chaserCard corrompu et le remplacer par une version complete
const oldCorrupted = `  function chaserCard(c) {

  function bindActions`;
const newChaserCard = `  function chaserCard(c) {
    var cls = c.active ? " on" : "";
    return "<div class=\"card" + cls + "\" data-id=\"" + esc(c.id) + "\">"
      + "<h3><span class=\"dot\"></span>" + esc(c.name || c.id) + "</h3>"
      + "<div class=\"row\">"
      + "<button class=\"btn nav\" data-a=\"previous\" type=\"button\">&#9664;</button>"
      + "<button class=\"btn play\" data-a=\"play\" type=\"button\">&#9654; Lire</button>"
      + "<button class=\"btn stop\" data-a=\"stop\" type=\"button\">&#9632; Stop</button>"
      + "<button class=\"btn nav\" data-a=\"next\" type=\"button\">&#9654;&#9654;</button>"
      + "</div></div>";
  }

  function bindActions`;

if (!s.includes(oldCorrupted)) throw new Error("corrupted chaserCard introuvable");
s = s.replace(oldCorrupted, newChaserCard);

fs.writeFileSync(p, s, "utf8");
console.log("chaserCard repare, taille=" + s.length);
