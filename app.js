const imageInput = document.querySelector("#imageInput");
const maxCellsInput = document.querySelector("#maxCellsInput");
const maxColorsInput = document.querySelector("#maxColorsInput");
const sampleModeInput = document.querySelector("#sampleMode");
const sampleModeHelp = document.querySelector("#sampleModeHelp");
const generateBtn = document.querySelector("#generateBtn");
const resetBtn = document.querySelector("#resetBtn");
const exportBtn = document.querySelector("#exportBtn");
const previewZoomInput = document.querySelector("#previewZoom");
const gridSizeText = document.querySelector("#gridSizeText");
const statusText = document.querySelector("#statusText");
const summaryText = document.querySelector("#summaryText");
const emptyState = document.querySelector("#emptyState");
const previewCanvas = document.querySelector("#patternCanvas");
const sourcePreview = document.querySelector("#sourcePreview");
const sourcePreviewImage = document.querySelector("#sourcePreviewImage");
const sourcePreviewText = document.querySelector("#sourcePreviewText");
const cellEditor = document.querySelector("#cellEditor");
const selectedCellText = document.querySelector("#selectedCellText");
const replacementOptions = document.querySelector("#replacementOptions");

const allowedExtensions = new Set(["jpg", "jpeg", "png", "bmp", "svg"]);
const allowedTypes = new Set(["image/jpeg", "image/png", "image/bmp", "image/svg+xml"]);
const exportScale = 3;
const maxExportCanvasSide = 12000;
const defaultMaxCells = 50;
const defaultMaxColors = 221;
const defaultSampleMode = "average";
const defaultPreviewZoom = "fit";
const sampleModeTips = {
  average: "区域平均：整体最稳，适合照片和渐变图，推荐默认使用。",
  center: "中心取色：保留局部细节，适合线稿、像素画和边界清楚的图。",
  dominant: "主色采样：突出每格主颜色，适合色块明显、颜色较纯的图。",
};

const mardColors = (window.MARD_221_COLORS || []).map((color) => ({
  ...color,
  lab: rgbToLab(color.hex),
}));
const mardByLabel = new Map(mardColors.map((color) => [color.label, color]));

let sourceImage = null;
let sourceFileName = "";
let sourceObjectUrl = "";
let lastPattern = null;
let selectedCellIndex = -1;

imageInput.addEventListener("change", handleImageUpload);
maxCellsInput.addEventListener("input", updateGridSize);
maxColorsInput.addEventListener("input", () => {
  if (sourceImage) setStatus("最大颜色数已更新，可以重新生成图纸。");
});
sampleModeInput.addEventListener("change", () => {
  updateSampleModeHelp();
  if (sourceImage) setStatus("采样方式已更新，可以重新生成图纸。");
});
generateBtn.addEventListener("click", generatePattern);
resetBtn.addEventListener("click", resetPreview);
exportBtn.addEventListener("click", exportPattern);
previewCanvas.addEventListener("click", handleCanvasClick);
previewZoomInput.addEventListener("change", () => {
  if (lastPattern) renderPattern(lastPattern, previewCanvas, 1, true);
});
updateSampleModeHelp();

function handleImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!isAllowedImage(file)) {
    setStatus("图片格式不支持。请上传 JPG/JPEG、PNG、BMP 或 SVG。", true);
    imageInput.value = "";
    return;
  }

  if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
  sourceObjectUrl = URL.createObjectURL(file);

  const image = new Image();
  image.onload = () => {
    sourceImage = image;
    sourceFileName = file.name.replace(/\.[^.]+$/, "");
    generateBtn.disabled = false;
    resetBtn.disabled = false;
    updateGridSize();
    updateSourcePreview(file.name, image);
    resetPreview(false);
    setStatus(`已读取图片：${file.name}（${image.naturalWidth} x ${image.naturalHeight}px）`);
  };
  image.onerror = () => {
    setStatus("图片读取失败。部分 SVG 如果引用了外部资源，浏览器可能无法直接处理。", true);
    imageInput.value = "";
  };
  image.src = sourceObjectUrl;
}

function isAllowedImage(file) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return allowedExtensions.has(extension) && (allowedTypes.has(file.type) || file.type === "");
}

function updateGridSize() {
  if (!sourceImage) {
    gridSizeText.textContent = "请先上传图片";
    return;
  }
  const size = calculateGridSize(sourceImage.naturalWidth, sourceImage.naturalHeight, getMaxCells());
  gridSizeText.textContent = `${size.cols} 列 x ${size.rows} 行`;
}

function getMaxCells() {
  const value = Math.round(Number(maxCellsInput.value) || 50);
  return Math.max(8, Math.min(240, value));
}

function getMaxColors() {
  const value = Math.round(Number(maxColorsInput.value) || 221);
  return Math.max(1, Math.min(221, value));
}

function getPreviewZoom() {
  return previewZoomInput.value || "fit";
}

function updateSampleModeHelp() {
  sampleModeHelp.textContent = sampleModeTips[sampleModeInput.value] || sampleModeTips.average;
}

function updateSourcePreview(fileName, image) {
  sourcePreviewImage.src = sourceObjectUrl;
  sourcePreviewText.textContent = `${fileName}（${image.naturalWidth} x ${image.naturalHeight}px）`;
  sourcePreview.classList.remove("hidden");
}

function clearSourcePreview() {
  sourcePreviewImage.removeAttribute("src");
  sourcePreviewText.textContent = "未上传";
  sourcePreview.classList.add("hidden");
}

function calculateGridSize(width, height, maxCells) {
  if (width >= height) {
    return {
      cols: maxCells,
      rows: Math.max(1, Math.round((height / width) * maxCells)),
    };
  }
  return {
    cols: Math.max(1, Math.round((width / height) * maxCells)),
    rows: maxCells,
  };
}

function generatePattern() {
  if (!sourceImage) return;

  const grid = calculateGridSize(sourceImage.naturalWidth, sourceImage.naturalHeight, getMaxCells());
  const sampleMode = sampleModeInput.value;
  const sampleModeName = {
    average: "区域平均",
    center: "中心取色",
    dominant: "主色采样",
  }[sampleMode];
  setStatus(`正在生成 ${grid.cols} x ${grid.rows} 图纸，使用${sampleModeName}...`);

  let sampled;
  try {
    sampled = sampleImage(sourceImage, grid.cols, grid.rows, sampleMode);
  } catch (error) {
    setStatus("无法读取图片像素。请确认 SVG 没有引用外部图片，或改用 PNG/JPG 后重试。", true);
    return;
  }

  const cells = [];
  const rawOptions = [];
  for (const pixel of sampled) {
    const lab = rgbToLabFromValues(pixel.r, pixel.g, pixel.b);
    const nearestColors = findNearestMardColors(lab, 4);
    cells.push(nearestColors[0]);
    rawOptions.push(nearestColors);
  }

  const mergeResult = limitColorCount(cells, getMaxColors());
  const originalCells = cells.slice();
  const originalOptions = rawOptions.map((options, index) => normalizeCellOptions(originalCells[index], options));
  const palette = buildPalette(cells);

  lastPattern = {
    cols: grid.cols,
    rows: grid.rows,
    cells,
    originalCells,
    originalOptions,
    palette,
    selectedIndex: -1,
  };

  renderPattern(lastPattern, previewCanvas, 1, true);

  const totalBeads = grid.cols * grid.rows;
  summaryText.textContent = `${grid.cols} 列 x ${grid.rows} 行，共 ${totalBeads} 颗，使用 ${palette.length} 种 Mard 色。`;
  if (mergeResult.merges > 0) {
    summaryText.textContent += ` 已合并 ${mergeResult.merges} 次以满足最大颜色数 ${getMaxColors()}。`;
  }
  setStatus("图纸已生成。预览会自动缩放以便尽量完整显示，导出会使用高清尺寸。");
  exportBtn.disabled = false;
  emptyState.classList.add("hidden");
  hideCellEditor();
}

function handleCanvasClick(event) {
  if (!lastPattern) return;
  const layout = createPatternLayout(lastPattern);
  const rect = previewCanvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (previewCanvas.width / rect.width);
  const y = (event.clientY - rect.top) * (previewCanvas.height / rect.height);

  if (
    x < layout.gridLeft ||
    x >= layout.gridLeft + layout.gridWidth ||
    y < layout.gridTop ||
    y >= layout.gridTop + layout.gridHeight
  ) {
    hideCellEditor();
    return;
  }

  const col = Math.floor((x - layout.gridLeft) / layout.cell);
  const row = Math.floor((y - layout.gridTop) / layout.cell);
  selectedCellIndex = row * lastPattern.cols + col;
  lastPattern.selectedIndex = selectedCellIndex;
  renderPattern(lastPattern, previewCanvas, 1, true);
  showCellEditor(row, col);
}

function showCellEditor(row, col) {
  if (!lastPattern || selectedCellIndex < 0) return;
  const currentColor = lastPattern.cells[selectedCellIndex];
  const originalColor = lastPattern.originalCells[selectedCellIndex] || currentColor;
  selectedCellText.textContent = `第 ${row + 1} 行，第 ${col + 1} 列：原始 ${originalColor.label}，当前 ${currentColor.label}`;
  replacementOptions.innerHTML = "";

  const replacementColors = lastPattern.originalOptions?.[selectedCellIndex] || [originalColor];
  for (const replacement of replacementColors) {
    if (!replacement) continue;
    const label = replacement.label;
    const row = document.createElement("div");
    row.className = "replacement-option";
    row.innerHTML = `
      <span class="replacement-swatch" style="background:${replacement.hex};color:${textColorFor(replacement.hex)}">${replacement.label}</span>
      <span class="replacement-actions"></span>
    `;

    const actions = row.querySelector(".replacement-actions");
    const singleButton = document.createElement("button");
    singleButton.type = "button";
    singleButton.textContent =
      label === originalColor.label ? `恢复当前格为原始 ${replacement.label}` : `替换当前格为 ${replacement.label}`;
    singleButton.addEventListener("click", () => applyReplacement(replacement, "single", originalColor.label));
    actions.appendChild(singleButton);

    const allButton = document.createElement("button");
    allButton.type = "button";
    allButton.textContent =
      label === originalColor.label
        ? `全部原始 ${originalColor.label} 恢复为 ${replacement.label}`
        : `全部原始 ${originalColor.label} 替换为 ${replacement.label}`;
    allButton.addEventListener("click", () => applyReplacement(replacement, "all", originalColor.label));
    actions.appendChild(allButton);

    replacementOptions.appendChild(row);
  }

  cellEditor.classList.remove("hidden");
  cellEditor.scrollIntoView({ block: "start", behavior: "smooth" });
}

function applyReplacement(color, mode = "single", sourceLabel = "") {
  if (!lastPattern || selectedCellIndex < 0) return;
  let changed = 0;

  if (mode === "all") {
    for (let index = 0; index < lastPattern.cells.length; index += 1) {
      if ((lastPattern.originalCells[index] || lastPattern.cells[index]).label === sourceLabel) {
        lastPattern.cells[index] = color;
        changed += 1;
      }
    }
  } else {
    lastPattern.cells[selectedCellIndex] = color;
    changed = 1;
  }

  lastPattern.palette = buildPalette(lastPattern.cells);
  renderPattern(lastPattern, previewCanvas, 1, true);
  refreshSummary();
  const row = Math.floor(selectedCellIndex / lastPattern.cols);
  const col = selectedCellIndex % lastPattern.cols;
  showCellEditor(row, col);

  if (mode === "all") {
    setStatus(`已将 ${changed} 个原始 ${sourceLabel} 的格子全部设置为 ${color.label}。`);
  } else {
    setStatus(`已将第 ${row + 1} 行、第 ${col + 1} 列更新为 ${color.label}。`);
  }
}

function hideCellEditor() {
  selectedCellIndex = -1;
  if (lastPattern) lastPattern.selectedIndex = -1;
  cellEditor.classList.add("hidden");
  selectedCellText.textContent = "未选择";
  replacementOptions.innerHTML = "";
  if (lastPattern) renderPattern(lastPattern, previewCanvas, 1, true);
}

function refreshSummary(extraText = "") {
  if (!lastPattern) return;
  const totalBeads = lastPattern.cols * lastPattern.rows;
  summaryText.textContent = `${lastPattern.cols} 列 x ${lastPattern.rows} 行，共 ${totalBeads} 颗，使用 ${lastPattern.palette.length} 种 Mard 色。${extraText}`;
}

function sampleImage(image, cols, rows, mode) {
  if (mode === "center") return sampleCenterColors(image, cols, rows);
  if (mode === "average") return sampleAverageColors(image, cols, rows);
  return sampleDominantColors(image, cols, rows);
}

function getSourceImageData(image) {
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = image.naturalWidth;
  sourceCanvas.height = image.naturalHeight;
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  sourceCtx.drawImage(image, 0, 0);
  return sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
}

function sampleCenterColors(image, cols, rows) {
  const offscreen = document.createElement("canvas");
  offscreen.width = cols;
  offscreen.height = rows;
  const offCtx = offscreen.getContext("2d", { willReadFrequently: true });
  offCtx.imageSmoothingEnabled = false;
  offCtx.drawImage(image, 0, 0, cols, rows);
  return readPixels(offCtx.getImageData(0, 0, cols, rows).data);
}

function readPixels(data) {
  const pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    pixels.push({
      r: Math.round(data[i] * alpha + 255 * (1 - alpha)),
      g: Math.round(data[i + 1] * alpha + 255 * (1 - alpha)),
      b: Math.round(data[i + 2] * alpha + 255 * (1 - alpha)),
    });
  }
  return pixels;
}

function sampleAverageColors(image, cols, rows) {
  const imageData = getSourceImageData(image);
  const { width, height, data } = imageData;
  const pixels = [];

  for (let row = 0; row < rows; row += 1) {
    const yStart = Math.floor((row / rows) * height);
    const yEnd = Math.max(yStart + 1, Math.floor(((row + 1) / rows) * height));

    for (let col = 0; col < cols; col += 1) {
      const xStart = Math.floor((col / cols) * width);
      const xEnd = Math.max(xStart + 1, Math.floor(((col + 1) / cols) * width));
      let r = 0;
      let g = 0;
      let b = 0;
      let total = 0;

      for (let y = yStart; y < yEnd; y += 1) {
        for (let x = xStart; x < xEnd; x += 1) {
          const index = (y * width + x) * 4;
          const alpha = data[index + 3] / 255;
          r += data[index] * alpha + 255 * (1 - alpha);
          g += data[index + 1] * alpha + 255 * (1 - alpha);
          b += data[index + 2] * alpha + 255 * (1 - alpha);
          total += 1;
        }
      }

      pixels.push({
        r: Math.round(r / total),
        g: Math.round(g / total),
        b: Math.round(b / total),
      });
    }
  }

  return pixels;
}

function sampleDominantColors(image, cols, rows) {
  const imageData = getSourceImageData(image);
  const { width, height, data } = imageData;
  const pixels = [];

  for (let row = 0; row < rows; row += 1) {
    const yStart = Math.floor((row / rows) * height);
    const yEnd = Math.max(yStart + 1, Math.floor(((row + 1) / rows) * height));

    for (let col = 0; col < cols; col += 1) {
      const xStart = Math.floor((col / cols) * width);
      const xEnd = Math.max(xStart + 1, Math.floor(((col + 1) / cols) * width));
      const buckets = new Map();

      for (let y = yStart; y < yEnd; y += 1) {
        for (let x = xStart; x < xEnd; x += 1) {
          const index = (y * width + x) * 4;
          const alpha = data[index + 3] / 255;
          const r = Math.round(data[index] * alpha + 255 * (1 - alpha));
          const g = Math.round(data[index + 1] * alpha + 255 * (1 - alpha));
          const b = Math.round(data[index + 2] * alpha + 255 * (1 - alpha));
          const key = `${r >> 3},${g >> 3},${b >> 3}`;
          const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
          bucket.count += 1;
          bucket.r += r;
          bucket.g += g;
          bucket.b += b;
          buckets.set(key, bucket);
        }
      }

      let dominant = null;
      for (const bucket of buckets.values()) {
        if (!dominant || bucket.count > dominant.count) dominant = bucket;
      }

      pixels.push({
        r: Math.round(dominant.r / dominant.count),
        g: Math.round(dominant.g / dominant.count),
        b: Math.round(dominant.b / dominant.count),
      });
    }
  }

  return pixels;
}

function findNearestMardColors(lab, count = 4) {
  return mardColors
    .map((color) => ({
      ...color,
      delta: deltaE2000(lab, color.lab),
    }))
    .sort((a, b) => a.delta - b.delta)
    .slice(0, count)
    .map(({ delta, ...color }) => color);
}

function normalizeCellOptions(originalColor, directOptions) {
  const options = [];
  const seen = new Set();
  for (const color of [originalColor, ...directOptions]) {
    if (!color || seen.has(color.label)) continue;
    options.push(mardByLabel.get(color.label) || color);
    seen.add(color.label);
    if (options.length >= 4) break;
  }
  return options;
}

function buildPalette(cells) {
  const counts = new Map();
  for (const color of cells) {
    counts.set(color.label, (counts.get(color.label) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ ...mardByLabel.get(label), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "en", { numeric: true }));
}

function limitColorCount(cells, maxColors) {
  let palette = buildPalette(cells);
  let merges = 0;

  while (palette.length > maxColors) {
    let bestMerge = null;

    for (const source of palette) {
      const candidates = palette.filter((target) => target.label !== source.label && target.count >= source.count);
      if (candidates.length === 0) continue;

      for (const target of candidates) {
        const delta = deltaE2000(source.lab, target.lab);
        const cost = delta * source.count;
        if (!bestMerge || cost < bestMerge.cost) {
          bestMerge = { source, target, cost };
        }
      }
    }

    if (!bestMerge) break;

    for (let index = 0; index < cells.length; index += 1) {
      if (cells[index].label === bestMerge.source.label) {
        cells[index] = mardByLabel.get(bestMerge.target.label);
      }
    }

    merges += 1;
    palette = buildPalette(cells);
  }

  return { merges, palette };
}

function renderPattern(pattern, targetCanvas, scale = 1, fitPreview = false) {
  const layout = createPatternLayout(pattern);
  const ctx = targetCanvas.getContext("2d");
  targetCanvas.width = Math.ceil(layout.width * scale);
  targetCanvas.height = Math.ceil(layout.height * scale);
  targetCanvas.style.aspectRatio = `${layout.width} / ${layout.height}`;

  if (fitPreview) {
    const zoom = getPreviewZoom();
    targetCanvas.parentElement.classList.toggle("fit-preview", zoom === "fit");
    targetCanvas.style.width = zoom === "fit" ? "auto" : `${layout.width * Number(zoom)}px`;
    targetCanvas.style.height = "auto";
  }

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, layout.width, layout.height);

  drawGridLabels(ctx, pattern, layout);
  drawCells(ctx, pattern, layout);
  drawGridLines(ctx, pattern.cols, pattern.rows, layout.gridLeft, layout.gridTop, layout.cell);
  drawSelection(ctx, pattern, layout);
  drawLegend(ctx, pattern.palette, layout.legend, layout.pagePadding, layout.legendTop, layout.width);
}

function createPatternLayout(pattern) {
  const cell = chooseCellSize(pattern.cols, pattern.rows);
  const labelBand = cell >= 15 ? 18 : 14;
  const pagePadding = 24;
  const gridLeft = pagePadding + labelBand;
  const gridTop = pagePadding + labelBand;
  const gridWidth = pattern.cols * cell;
  const gridHeight = pattern.rows * cell;
  const legend = layoutLegend(pattern.palette, cell);
  const gridCanvasWidth = gridLeft + gridWidth + labelBand + pagePadding;
  const legendCanvasWidth = pagePadding * 2 + legend.cols * legend.itemWidth;
  const width = Math.max(gridCanvasWidth, legendCanvasWidth);
  const legendTop = gridTop + gridHeight + labelBand + 18;
  const bottomPadding = 28;
  const height = legendTop + legend.height + bottomPadding;

  return {
    cell,
    pagePadding,
    labelBand,
    gridLeft,
    gridTop,
    gridWidth,
    gridHeight,
    legend,
    legendTop,
    bottomPadding,
    width,
    height,
  };
}

function chooseCellSize(cols, rows) {
  const largest = Math.max(cols, rows);
  if (largest <= 40) return 26;
  if (largest <= 70) return 20;
  if (largest <= 110) return 16;
  return 12;
}

function drawCells(ctx, pattern, layout) {
  const { cell, gridLeft, gridTop } = layout;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.max(8, Math.floor(cell * 0.42))}px ui-monospace, Consolas, monospace`;

  for (let row = 0; row < pattern.rows; row += 1) {
    for (let col = 0; col < pattern.cols; col += 1) {
      const color = pattern.cells[row * pattern.cols + col];
      const x = gridLeft + col * cell;
      const y = gridTop + row * cell;
      ctx.fillStyle = color.hex;
      ctx.fillRect(x, y, cell, cell);

      if (cell >= 10) {
        ctx.fillStyle = textColorFor(color.hex);
        ctx.fillText(color.label, x + cell / 2, y + cell / 2);
      }
    }
  }
}

function drawGridLines(ctx, cols, rows, left, top, cell) {
  ctx.save();
  ctx.strokeStyle = "#000000";

  for (let col = 0; col <= cols; col += 1) {
    ctx.lineWidth = col % 5 === 0 ? 2.4 : 0.65;
    const x = Math.round(left + col * cell) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + rows * cell);
    ctx.stroke();
  }

  for (let row = 0; row <= rows; row += 1) {
    ctx.lineWidth = row % 5 === 0 ? 2.4 : 0.65;
    const y = Math.round(top + row * cell) + 0.5;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + cols * cell, y);
    ctx.stroke();
  }

  ctx.restore();
}

function drawSelection(ctx, pattern, layout) {
  if (pattern.selectedIndex == null || pattern.selectedIndex < 0) return;
  const row = Math.floor(pattern.selectedIndex / pattern.cols);
  const col = pattern.selectedIndex % pattern.cols;
  const x = layout.gridLeft + col * layout.cell;
  const y = layout.gridTop + row * layout.cell;

  ctx.save();
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 4;
  ctx.strokeRect(x + 2, y + 2, layout.cell - 4, layout.cell - 4);
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 4, y + 4, layout.cell - 8, layout.cell - 8);
  ctx.restore();
}

function drawGridLabels(ctx, pattern, layout) {
  const { cell, labelBand, gridLeft, gridTop, gridWidth, gridHeight } = layout;
  const labelLeft = gridLeft - labelBand;
  const labelTop = gridTop - labelBand;
  ctx.fillStyle = "#A9B4F0";
  ctx.fillRect(gridLeft, labelTop, gridWidth, labelBand);
  ctx.fillRect(gridLeft, gridTop + gridHeight, gridWidth, labelBand);
  ctx.fillRect(labelLeft, gridTop, labelBand, gridHeight);
  ctx.fillRect(gridLeft + gridWidth, gridTop, labelBand, gridHeight);

  ctx.fillStyle = "#111111";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.max(8, Math.min(12, cell * 0.45))}px ui-monospace, Consolas, monospace`;

  for (let col = 0; col < pattern.cols; col += 1) {
    const x = gridLeft + col * cell + cell / 2;
    const label = String(col + 1);
    ctx.fillText(label, x, labelTop + labelBand / 2);
    ctx.fillText(label, x, gridTop + gridHeight + labelBand / 2);
  }
  for (let row = 0; row < pattern.rows; row += 1) {
    const y = gridTop + row * cell + cell / 2;
    const label = String(row + 1);
    ctx.fillText(label, labelLeft + labelBand / 2, y);
    ctx.fillText(label, gridLeft + gridWidth + labelBand / 2, y);
  }
}

function layoutLegend(palette, cell) {
  const itemWidth = Math.max(86, cell * 4.2);
  const itemHeight = 72;
  const availableWidth = Math.max(760, window.innerWidth - 430);
  const cols = Math.max(1, Math.floor(availableWidth / itemWidth));
  const rows = Math.ceil(palette.length / cols);
  return {
    cols,
    itemWidth,
    itemHeight,
    height: rows * itemHeight + 8,
  };
}

function drawLegend(ctx, palette, layout, x0, y0, canvasWidth) {
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, y0 - 8, canvasWidth, layout.height + 8);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  palette.forEach((color, index) => {
    const col = index % layout.cols;
    const row = Math.floor(index / layout.cols);
    const x = x0 + col * layout.itemWidth + 10;
    const y = y0 + row * layout.itemHeight;
    const swatchW = Math.min(50, layout.itemWidth - 16);
    const swatchH = 31;

    roundRect(ctx, x, y, swatchW, swatchH, 7, color.hex);
    ctx.strokeStyle = "#777777";
    ctx.lineWidth = 0.8;
    roundRect(ctx, x, y, swatchW, swatchH, 7, null, true);

    ctx.fillStyle = textColorFor(color.hex);
    ctx.font = "11px ui-monospace, Consolas, monospace";
    ctx.fillText(color.label, x + swatchW / 2, y + swatchH / 2);

    ctx.fillStyle = "#111111";
    ctx.font = "11px ui-monospace, Consolas, monospace";
    ctx.fillText(String(color.count), x + swatchW / 2, y + swatchH + 13);

    ctx.fillStyle = "#5F5A52";
    drawFittedText(
      ctx,
      `替代:${(color.alternatives || []).join("/")}`,
      x + swatchW / 2,
      y + swatchH + 31,
      layout.itemWidth - 10,
      10,
      "#5F5A52",
    );
  });
}

function drawFittedText(ctx, text, x, y, maxWidth, startSize, color) {
  let size = startSize;
  ctx.fillStyle = color;
  ctx.font = `${size}px ui-monospace, Consolas, monospace`;

  while (size > 7 && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = `${size}px ui-monospace, Consolas, monospace`;
  }

  if (ctx.measureText(text).width <= maxWidth) {
    ctx.fillText(text, x, y);
    return;
  }

  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}...`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  ctx.fillText(`${clipped}...`, x, y);
}

function roundRect(ctx, x, y, w, h, r, fill, stroke = false) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) ctx.stroke();
}

function exportPattern() {
  if (!lastPattern) return;
  const outputCanvas = document.createElement("canvas");
  const layout = createPatternLayout(lastPattern);
  const safeScale = Math.min(exportScale, maxExportCanvasSide / layout.width, maxExportCanvasSide / layout.height);
  renderPattern(lastPattern, outputCanvas, Math.max(1, safeScale), false);
  const link = document.createElement("a");
  link.download = `${sourceFileName || "拼豆图纸"}_${lastPattern.cols}x${lastPattern.rows}_高清.png`;
  link.href = outputCanvas.toDataURL("image/png");
  link.click();
}

function resetPreview(clearImage = true) {
  lastPattern = null;
  selectedCellIndex = -1;
  exportBtn.disabled = true;
  summaryText.textContent = "上传图片后会在这里生成带网格和图例的预览图。";
  cellEditor.classList.add("hidden");
  selectedCellText.textContent = "未选择";
  replacementOptions.innerHTML = "";
  const ctx = previewCanvas.getContext("2d");
  ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  previewCanvas.width = 0;
  previewCanvas.height = 0;
  previewCanvas.style.width = "";
  previewCanvas.style.height = "";
  previewCanvas.parentElement.classList.add("fit-preview");
  emptyState.classList.remove("hidden");
  if (clearImage) {
    sourceImage = null;
    sourceFileName = "";
    if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
    sourceObjectUrl = "";
    imageInput.value = "";
    clearSourcePreview();
    maxCellsInput.value = String(defaultMaxCells);
    maxColorsInput.value = String(defaultMaxColors);
    sampleModeInput.value = defaultSampleMode;
    previewZoomInput.value = defaultPreviewZoom;
    updateSampleModeHelp();
    generateBtn.disabled = true;
    resetBtn.disabled = true;
    updateGridSize();
    setStatus("已取消，页面已恢复默认状态。可以重新上传图片。");
  }
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.style.color = isError ? "#B42318" : "";
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
  };
}

function srgbToLinear(value) {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function rgbToLab(hex) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToLabFromValues(r, g, b);
}

function rgbToLabFromValues(r, g, b) {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) * 100;
  const y = (0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl) * 100;
  const z = (0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl) * 100;

  const f = (t) => (t > 0.008856451679 ? Math.cbrt(t) : 7.787037037 * t + 16 / 116);
  const fx = f(x / 95.047);
  const fy = f(y / 100);
  const fz = f(z / 108.883);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function deg(rad) {
  return (rad * 180) / Math.PI;
}

function rad(degValue) {
  return (degValue * Math.PI) / 180;
}

function deltaE2000(lab1, lab2) {
  const c1 = Math.sqrt(lab1.a ** 2 + lab1.b ** 2);
  const c2 = Math.sqrt(lab2.a ** 2 + lab2.b ** 2);
  const cBar = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1p = (1 + g) * lab1.a;
  const a2p = (1 + g) * lab2.a;
  const c1p = Math.sqrt(a1p ** 2 + lab1.b ** 2);
  const c2p = Math.sqrt(a2p ** 2 + lab2.b ** 2);
  const hPrime = (a, b) => {
    if (a === 0 && b === 0) return 0;
    const h = deg(Math.atan2(b, a));
    return h >= 0 ? h : h + 360;
  };
  const h1p = hPrime(a1p, lab1.b);
  const h2p = hPrime(a2p, lab2.b);
  const dLp = lab2.L - lab1.L;
  const dCp = c2p - c1p;
  let dhp = h2p - h1p;

  if (c1p * c2p === 0) dhp = 0;
  else if (dhp > 180) dhp -= 360;
  else if (dhp < -180) dhp += 360;

  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin(rad(dhp / 2));
  const lBarP = (lab1.L + lab2.L) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBarP;

  if (c1p * c2p === 0) hBarP = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hBarP = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hBarP = (h1p + h2p + 360) / 2;
  else hBarP = (h1p + h2p - 360) / 2;

  const t =
    1 -
    0.17 * Math.cos(rad(hBarP - 30)) +
    0.24 * Math.cos(rad(2 * hBarP)) +
    0.32 * Math.cos(rad(3 * hBarP + 6)) -
    0.2 * Math.cos(rad(4 * hBarP - 63));
  const deltaTheta = 30 * Math.exp(-(((hBarP - 275) / 25) ** 2));
  const rC = 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7));
  const sL = 1 + (0.015 * (lBarP - 50) ** 2) / Math.sqrt(20 + (lBarP - 50) ** 2);
  const sC = 1 + 0.045 * cBarP;
  const sH = 1 + 0.015 * cBarP * t;
  const rT = -Math.sin(rad(2 * deltaTheta)) * rC;

  return Math.sqrt(
    (dLp / sL) ** 2 + (dCp / sC) ** 2 + (dHp / sH) ** 2 + rT * (dCp / sC) * (dHp / sH),
  );
}

function textColorFor(hex) {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? "#111111" : "#FFFFFF";
}
