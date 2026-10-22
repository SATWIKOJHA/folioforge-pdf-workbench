const tools = {
  merge: {
    kicker: "PDF assembly", title: "Merge PDFs", dropTitle: "Drop two or more PDFs here", limit: "Up to 8 PDFs · 40 MB combined",
    hint: "Arrange files in the order you want them combined.", action: "Merge PDFs", minimum: 2,
  },
  split: {
    kicker: "Page separation", title: "Split a PDF", dropTitle: "Drop a PDF here", limit: "One PDF · 40 MB maximum",
    hint: "You’ll receive a ZIP with one PDF for every page.", action: "Split PDF", minimum: 1,
  },
  compress: {
    kicker: "Document tune-up", title: "Compress a PDF", dropTitle: "Drop a PDF here", limit: "One PDF · 40 MB maximum",
    hint: "We’ll optimize structure and streams without changing the content.", action: "Compress PDF", minimum: 1,
  },
  rotate: {
    kicker: "Orientation", title: "Rotate a PDF", dropTitle: "Drop a PDF here", limit: "One PDF · 40 MB maximum",
    hint: "Choose a rotation to apply to every page.", action: "Rotate PDF", minimum: 1,
    options: '<label class="option-label" for="rotation">ROTATE EVERY PAGE</label><select class="select-like" id="rotation"><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">90° counter-clockwise</option></select>',
  },
  extract: {
    kicker: "Page selection", title: "Extract pages", dropTitle: "Drop a PDF here", limit: "One PDF · 40 MB maximum",
    hint: "Choose the pages you want to keep, for example 1-3, 5, 8-10.", action: "Extract pages", minimum: 1,
    options: '<label class="option-label" for="pages">PAGES TO KEEP</label><input class="text-option" id="pages" inputmode="numeric" placeholder="e.g. 1-3, 5, 8-10" aria-label="Pages to keep" />',
  },
};

let selectedTool = "merge";
let selectedFiles = [];

const fileInput = document.querySelector("#file-input");
const fileList = document.querySelector("#file-list");
const queueEmpty = document.querySelector("#queue-empty");
const dropzone = document.querySelector("#dropzone");
const dropTitle = document.querySelector("#drop-title");
const fileLimit = document.querySelector("#file-limit");
const toolKicker = document.querySelector("#tool-kicker");
const workspaceTitle = document.querySelector("#workspace-title");
const toolOptions = document.querySelector("#tool-options");
const actionHint = document.querySelector("#action-hint");
const processButton = document.querySelector("#process-button");
const statusMessage = document.querySelector("#status-message");
const resultCard = document.querySelector("#result-card");
const resultTitle = document.querySelector("#result-title");
const resultMeta = document.querySelector("#result-meta");
const downloadLink = document.querySelector("#download-link");

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validFiles(files) {
  return [...files].filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
}

function renderQueue() {
  const tool = tools[selectedTool];
  fileList.innerHTML = "";
  queueEmpty.hidden = selectedFiles.length > 0;
  selectedFiles.forEach((file, index) => {
    const item = document.createElement("li");
    item.className = "file-item";
    item.innerHTML = `<span class="file-icon">PDF</span><span class="file-name"><strong>${escapeHtml(file.name)}</strong><small>${formatBytes(file.size)}</small></span><button type="button" class="remove-file" aria-label="Remove ${escapeHtml(file.name)}" data-index="${index}">×</button>`;
    fileList.append(item);
  });
  const enoughFiles = selectedFiles.length >= tool.minimum && selectedFiles.length <= (selectedTool === "merge" ? 8 : 1);
  processButton.disabled = !enoughFiles;
  processButton.innerHTML = `${tool.action} <span aria-hidden="true">→</span>`;
  fileList.querySelectorAll(".remove-file").forEach((button) => button.addEventListener("click", () => {
    selectedFiles.splice(Number(button.dataset.index), 1);
    renderQueue();
  }));
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function selectTool(toolName) {
  selectedTool = toolName;
  selectedFiles = [];
  fileInput.value = "";
  resultCard.hidden = true;
  statusMessage.textContent = "";
  const tool = tools[selectedTool];
  toolKicker.textContent = tool.kicker;
  workspaceTitle.textContent = tool.title;
  dropTitle.textContent = tool.dropTitle;
  fileLimit.textContent = tool.limit;
  actionHint.textContent = tool.hint;
  toolOptions.innerHTML = tool.options || "";
  toolOptions.hidden = !tool.options;
  document.querySelectorAll(".tool-card").forEach((card) => card.classList.toggle("is-selected", card.dataset.tool === selectedTool));
  renderQueue();
  document.querySelector("#workspace").scrollIntoView({ behavior: "smooth", block: "start" });
}

function addFiles(files) {
  const tool = tools[selectedTool];
  const candidateFiles = validFiles(files);
  if (!candidateFiles.length) {
    statusMessage.textContent = "Please select PDF files.";
    return;
  }
  const limit = selectedTool === "merge" ? 8 : 1;
  selectedFiles = [...selectedFiles, ...candidateFiles].slice(0, limit);
  const total = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  statusMessage.textContent = total > 40 * 1024 * 1024 ? "Please keep the combined upload below 40 MB." : "";
  renderQueue();
}

document.querySelector("#choose-files").addEventListener("click", () => fileInput.click());
dropzone.addEventListener("click", (event) => { if (!event.target.closest("button")) fileInput.click(); });
dropzone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInput.click(); } });
fileInput.addEventListener("change", () => addFiles(fileInput.files));
document.querySelectorAll(".tool-card").forEach((card) => card.addEventListener("click", () => selectTool(card.dataset.tool)));
["dragenter", "dragover"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.add("is-dragging"); }));
["dragleave", "drop"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.remove("is-dragging"); }));
dropzone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));

processButton.addEventListener("click", async () => {
  const total = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  if (total > 40 * 1024 * 1024) return;
  const form = new FormData();
  form.append("tool", selectedTool);
  selectedFiles.forEach((file) => form.append("files", file));
  if (selectedTool === "rotate") form.append("rotation", document.querySelector("#rotation").value);
  if (selectedTool === "extract") form.append("pages", document.querySelector("#pages").value.trim());

  processButton.disabled = true;
  processButton.innerHTML = "Working on your file <span class=\"spinner\" aria-hidden=\"true\">◌</span>";
  statusMessage.textContent = "Preparing your file on this computer…";
  resultCard.hidden = true;
  try {
    const response = await fetch("/api/process", { method: "POST", body: form });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The operation could not be completed.");
    resultTitle.textContent = "Your file is ready.";
    resultMeta.textContent = `${result.filename} · ${result.pageCount} page${result.pageCount === 1 ? "" : "s"}`;
    downloadLink.href = result.downloadUrl;
    downloadLink.download = result.filename;
    resultCard.hidden = false;
    statusMessage.textContent = "";
  } catch (error) {
    statusMessage.textContent = error.message;
  } finally {
    renderQueue();
  }
});

renderQueue();
