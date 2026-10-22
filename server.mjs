import { createServer } from "node:http";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, extname, join, normalize, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(projectRoot, "public");
const jobsRoot = join(projectRoot, "runtime", "jobs");
const port = Number(process.env.PORT || 4173);
const maxUploadBytes = 40 * 1024 * 1024;
const jobLifetimeMs = 60 * 60 * 1000;
const jobs = new Map();

const toolRules = {
  merge: { minFiles: 2, maxFiles: 8 },
  split: { minFiles: 1, maxFiles: 1 },
  compress: { minFiles: 1, maxFiles: 1 },
  rotate: { minFiles: 1, maxFiles: 1 },
  extract: { minFiles: 1, maxFiles: 1 },
};

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

function safeFilename(value) {
  const base = basename(value || "document.pdf");
  return base.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 100) || "document.pdf";
}

function isPdf(file) {
  return extname(file.filename).toLowerCase() === ".pdf" && file.data.subarray(0, 5).toString() === "%PDF-";
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxUploadBytes) {
      const error = new Error("The combined upload limit is 40 MB.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseMultipart(body, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || "");
  if (!boundaryMatch) throw new Error("Expected a multipart form upload.");
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const files = [];
  const fields = {};
  let cursor = body.indexOf(boundary);

  while (cursor !== -1) {
    const nextStart = cursor + boundary.length;
    if (body.subarray(nextStart, nextStart + 2).toString() === "--") break;
    const contentStart = nextStart + 2;
    const nextBoundary = body.indexOf(boundary, contentStart);
    if (nextBoundary === -1) break;
    const part = body.subarray(contentStart, nextBoundary - 2);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString("utf8");
      const payload = part.subarray(headerEnd + 4);
      const disposition = /content-disposition:\s*form-data;\s*([^\r\n]+)/i.exec(headers)?.[1] || "";
      const name = /name="([^"]+)"/i.exec(disposition)?.[1];
      const filename = /filename="([^"]*)"/i.exec(disposition)?.[1];
      if (name && filename !== undefined && filename !== "") {
        files.push({ field: name, filename: safeFilename(filename), data: payload });
      } else if (name) {
        fields[name] = payload.toString("utf8");
      }
    }
    cursor = nextBoundary;
  }
  return { files, fields };
}

function runWorker(args) {
  return new Promise((resolveWorker, rejectWorker) => {
    const worker = spawn("python3", [join(projectRoot, "scripts", "pdf_worker.py"), ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    worker.stdout.on("data", (chunk) => { stdout += chunk; });
    worker.stderr.on("data", (chunk) => { stderr += chunk; });
    worker.on("error", rejectWorker);
    worker.on("close", (code) => {
      if (code === 0) {
        try {
          resolveWorker(JSON.parse(stdout));
        } catch {
          rejectWorker(new Error("The PDF worker returned an invalid response."));
        }
      } else {
        rejectWorker(new Error(stderr.trim() || "The PDF operation could not be completed."));
      }
    });
  });
}

async function processUpload(request, response) {
  const body = await readRequestBody(request);
  const { files, fields } = parseMultipart(body, request.headers["content-type"]);
  const tool = fields.tool;
  const rule = toolRules[tool];
  if (!rule) return sendError(response, 400, "Choose one of the available PDF tools.");
  const uploadedFiles = files.filter((file) => file.field === "files");
  if (uploadedFiles.length < rule.minFiles || uploadedFiles.length > rule.maxFiles) {
    const countMessage = rule.minFiles === rule.maxFiles ? "exactly one PDF" : `${rule.minFiles} to ${rule.maxFiles} PDFs`;
    return sendError(response, 400, `This tool needs ${countMessage}.`);
  }
  if (!uploadedFiles.every(isPdf)) return sendError(response, 400, "Only valid PDF uploads are supported.");
  if (tool === "extract" && !/^\s*\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*\s*$/.test(fields.pages || "")) {
    return sendError(response, 400, "Enter pages like 1-3, 5, 8-10.");
  }
  if (tool === "rotate" && !["90", "180", "270"].includes(fields.rotation || "90")) {
    return sendError(response, 400, "Rotation must be 90°, 180°, or 270°.");
  }

  const id = randomUUID();
  const jobDirectory = join(jobsRoot, id);
  const inputDirectory = join(jobDirectory, "input");
  await mkdir(inputDirectory, { recursive: true });
  const inputPaths = await Promise.all(uploadedFiles.map(async (file, index) => {
    const inputPath = join(inputDirectory, `${String(index + 1).padStart(2, "0")}-${file.filename}`);
    await writeFile(inputPath, file.data);
    return inputPath;
  }));

  const result = await runWorker([
    "--tool", tool,
    "--output", jobDirectory,
    "--rotation", fields.rotation || "90",
    "--pages", fields.pages || "",
    ...inputPaths,
  ]);
  const outputPath = join(jobDirectory, result.output);
  await access(outputPath);
  jobs.set(id, { id, createdAt: Date.now(), outputPath, filename: result.filename, mime: result.mime });
  sendJson(response, 200, {
    id,
    filename: result.filename,
    downloadUrl: `/api/download/${id}`,
    pageCount: result.pageCount,
  });
}

async function serveDownload(response, id) {
  const job = jobs.get(id);
  if (!job) return sendError(response, 404, "That download has expired. Run the tool again.");
  try {
    const info = await stat(job.outputPath);
    response.writeHead(200, {
      "Content-Type": job.mime,
      "Content-Length": info.size,
      "Content-Disposition": `attachment; filename="${job.filename.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    });
    createReadStream(job.outputPath).pipe(response);
  } catch {
    jobs.delete(id);
    sendError(response, 404, "That download is no longer available.");
  }
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const target = normalize(resolve(publicRoot, requested));
  if (!target.startsWith(`${publicRoot}/`) && target !== join(publicRoot, "index.html")) return sendError(response, 403, "Not found.");
  try {
    const file = await readFile(target);
    response.writeHead(200, { "Content-Type": mimeTypes[extname(target)] || "application/octet-stream", "Cache-Control": "no-cache" });
    response.end(file);
  } catch {
    sendError(response, 404, "Not found.");
  }
}

async function cleanExpiredJobs() {
  const expiry = Date.now() - jobLifetimeMs;
  for (const [id, job] of jobs) {
    if (job.createdAt < expiry) {
      jobs.delete(id);
      await rm(join(jobsRoot, id), { recursive: true, force: true });
    }
  }
}

// Start each development run with a clean workspace.
await rm(jobsRoot, { recursive: true, force: true });
await mkdir(jobsRoot, { recursive: true });
setInterval(() => { cleanExpiredJobs().catch(() => {}); }, 15 * 60 * 1000).unref();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && url.pathname === "/api/health") return sendJson(response, 200, { status: "ok", service: "folioforge" });
    if (request.method === "POST" && url.pathname === "/api/process") return await processUpload(request, response);
    if (request.method === "GET" && url.pathname.startsWith("/api/download/")) return await serveDownload(response, url.pathname.split("/").at(-1));
    if (request.method === "GET") return await serveStatic(response, url.pathname);
    return sendError(response, 405, "Method not allowed.");
  } catch (error) {
    const status = error.status || 500;
    const message = status === 500 ? "We could not process that PDF. Try another file or tool." : error.message;
    sendError(response, status, message);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`FolioForge is running at http://127.0.0.1:${port}`);
});

async function shutdown() {
  server.close();
  await rm(jobsRoot, { recursive: true, force: true });
  process.exit(0);
}

process.once("SIGINT", () => { shutdown().catch(() => process.exit(1)); });
process.once("SIGTERM", () => { shutdown().catch(() => process.exit(1)); });
