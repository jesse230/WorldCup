const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = process.env.PORT || 3000;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

http
  .createServer((request, response) => {
    const requestPath = request.url.split("?")[0];
    const requestedPath = requestPath === "/" ? "/index.html" : decodeURIComponent(requestPath);
    const normalized = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
    const relativePath = normalized.replace(/^[/\\]+/, "");
    const filePath = path.join(root, relativePath);

    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      response.writeHead(200, {
        "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream"
      });
      response.end(content);
    });
  })
  .listen(port, () => {
    console.log(`World Cup predictor running at http://localhost:${port}`);
  });
