// api/proxy.js
// Serverless function di Vercel: ambil halaman asli dari app.dripwire.cc,
// lalu ganti teks nama/judul sebelum dikirim ke pengunjung.

const TARGET_ORIGIN = "https://app.dripwire.cc";

// ====== GANTI BAGIAN INI SESUAI KEINGINAN ======
const NEW_NAME = "NEXUS XIT";
const REPLACEMENTS = [
  // [teks lama, teks baru]
  ["DRIP WIRE", NEW_NAME],
  ["Drip Wire", NEW_NAME],
  ["dripwire", NEW_NAME.toLowerCase()],
];
// ================================================

export default async function handler(req, res) {
  try {
    const path = req.url === "/" ? "/" : req.url;
    const targetUrl = TARGET_ORIGIN + path;

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: {
        // teruskan beberapa header penting, tapi jangan teruskan host asli
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
        "Accept": req.headers["accept"] || "*/*",
        "Cookie": req.headers["cookie"] || "",
      },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
      redirect: "manual",
    });

    const contentType = upstream.headers.get("content-type") || "";

    // Teruskan cookie dari upstream (supaya login tetap jalan)
    const setCookie = upstream.headers.get("set-cookie");
    if (setCookie) res.setHeader("set-cookie", setCookie);

    // Kalau upstream redirect, ikuti tapi tetap di domain kita
    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      const location = upstream.headers.get("location") || "/";
      const relative = location.replace(TARGET_ORIGIN, "");
      res.writeHead(upstream.status, { Location: relative });
      return res.end();
    }

    if (contentType.includes("text/html")) {
      let html = await upstream.text();

      // Ganti semua kemunculan nama lama dengan nama baru (teks yang ada di HTML mentah)
      for (const [oldText, newText] of REPLACEMENTS) {
        html = html.split(oldText).join(newText);
      }

      // Skrip ini jalan di browser: mengganti teks yang dirender belakangan oleh JavaScript
      // (misalnya halaman yang dibangun pakai React/Vue), termasuk judul tab.
      const injectedScript = `
<script>
(function() {
  var replacements = ${JSON.stringify(REPLACEMENTS)};

  function replaceInNode(node) {
    if (node.nodeType === 3) { // text node
      var text = node.nodeValue;
      replacements.forEach(function(pair) {
        if (text.indexOf(pair[0]) !== -1) {
          text = text.split(pair[0]).join(pair[1]);
        }
      });
      if (text !== node.nodeValue) node.nodeValue = text;
    } else if (node.nodeType === 1) {
      for (var i = 0; i < node.childNodes.length; i++) {
        replaceInNode(node.childNodes[i]);
      }
    }
  }

  function replaceTitle() {
    var t = document.title;
    replacements.forEach(function(pair) {
      if (t.indexOf(pair[0]) !== -1) t = t.split(pair[0]).join(pair[1]);
    });
    if (t !== document.title) document.title = t;
  }

  function runAll() {
    replaceTitle();
    replaceInNode(document.body);
  }

  // Jalankan segera dan setiap kali ada perubahan DOM (misal React re-render)
  document.addEventListener("DOMContentLoaded", runAll);
  runAll();

  var observer = new MutationObserver(function() { runAll(); });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();
</script>
`;

      // Sisipkan skrip sebelum penutup </body>, atau di akhir kalau tidak ada tag itu
      if (html.includes("</body>")) {
        html = html.replace("</body>", injectedScript + "</body>");
      } else {
        html += injectedScript;
      }

      res.setHeader("content-type", "text/html; charset=utf-8");
      return res.status(upstream.status).send(html);
    }

    // Untuk file non-HTML (JS, CSS, gambar, dsb) teruskan apa adanya
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("content-type", contentType);
    return res.status(upstream.status).send(buffer);
  } catch (err) {
    res.status(500).send("Proxy error: " + err.message);
  }
}
