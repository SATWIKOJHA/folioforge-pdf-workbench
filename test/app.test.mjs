import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 4317;
const baseUrl = `http://127.0.0.1:${port}`;
let server;
let fixtureDirectory;

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Local server did not start.");
}

before(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), "folioforge-test-"));
  const fixturePath = join(fixtureDirectory, "sample.pdf");
  execFileSync("python3", ["-c", `import pymupdf as fitz; d=fitz.open(); d.new_page(); d.new_page(); d.save(${JSON.stringify(fixturePath)})`]);
  server = spawn("node", ["server.mjs"], { cwd: new URL("..", import.meta.url), env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  await waitForServer();
});

after(async () => {
  server?.kill();
  await rm(fixtureDirectory, { recursive: true, force: true });
});

test("health endpoint is available", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.deepEqual(await response.json(), { status: "ok", service: "folioforge" });
});

test("compress produces a downloadable PDF", async () => {
  const job = await runTool("compress");
  assert.equal(job.filename, "folioforge-compressed.pdf");
  const download = await downloadJob(job);
  assert.equal(download.byteLength > 100, true);
});

test("merge, split, rotate, and extract produce the expected local artifacts", async () => {
  const merged = await runTool("merge", { copies: 2 });
  assert.equal(merged.pageCount, 4);
  assert.equal((await downloadJob(merged)).subarray(0, 5).toString(), "%PDF-");

  const split = await runTool("split");
  assert.equal(split.filename, "folioforge-split-pages.zip");
  assert.equal((await downloadJob(split)).subarray(0, 2).toString(), "PK");

  const rotated = await runTool("rotate", { rotation: "90" });
  const rotatedPath = join(fixtureDirectory, "rotated.pdf");
  await writeFile(rotatedPath, await downloadJob(rotated));
  const rotation = execFileSync("python3", ["-c", `import pymupdf; print(pymupdf.open(${JSON.stringify(rotatedPath)})[0].rotation)`], { encoding: "utf8" }).trim();
  assert.equal(rotation, "90");

  const extracted = await runTool("extract", { pages: "2" });
  assert.equal(extracted.pageCount, 1);
  assert.equal((await downloadJob(extracted)).subarray(0, 5).toString(), "%PDF-");
});

async function runTool(tool, { copies = 1, rotation, pages } = {}) {
  const file = await readFile(join(fixtureDirectory, "sample.pdf"));
  const form = new FormData();
  form.append("tool", tool);
  for (let copy = 0; copy < copies; copy += 1) {
    form.append("files", new Blob([file], { type: "application/pdf" }), `sample-${copy + 1}.pdf`);
  }
  if (rotation) form.append("rotation", rotation);
  if (pages) form.append("pages", pages);
  const response = await fetch(`${baseUrl}/api/process`, { method: "POST", body: form });
  assert.equal(response.status, 200);
  return response.json();
}

async function downloadJob(job) {
  const download = await fetch(`${baseUrl}${job.downloadUrl}`);
  assert.equal(download.status, 200);
  return Buffer.from(await download.arrayBuffer());
}
