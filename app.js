const STORAGE_KEY = "gujeuk-handwritten-ledger-v1";

const canvases = [...document.querySelectorAll(".ink-canvas")];
const dateCell = document.querySelector("#dateCell");
const timeCell = document.querySelector("#timeCell");
const checkButtons = [...document.querySelectorAll(".check-cell")];
const countButtons = [...document.querySelectorAll(".count-button")];
const clearButton = document.querySelector("#clearButton");
const saveButton = document.querySelector("#saveButton");
const completeLayer = document.querySelector("#completeLayer");
const savedAtText = document.querySelector("#savedAtText");
const nextButton = document.querySelector("#nextButton");

const inkState = new WeakMap();
const countState = {
  maleCount: 0,
  femaleCount: 0,
};

const pad = (value) => String(value).padStart(2, "0");

const getNow = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());

  return {
    date: `${year}-${month}-${day}`,
    shortDate: `${Number(month)}/${Number(day)}`,
    time: `${hours}:${minutes}`,
    display: `${year}.${month}.${day} ${hours}:${minutes}`,
  };
};

const updateClock = () => {
  const now = getNow();
  dateCell.textContent = now.shortDate;
  timeCell.textContent = now.time;
};

const getCanvasContext = (canvas) => {
  const context = canvas.getContext("2d");
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "#161616";
  context.lineWidth = 2.6;
  return context;
};

const resizeCanvas = (canvas) => {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  const context = getCanvasContext(canvas);
  context.scale(ratio, ratio);
};

const getPoint = (event, canvas) => {
  const rect = canvas.getBoundingClientRect();

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
};

const beginStroke = (event) => {
  event.preventDefault();
  const canvas = event.currentTarget;
  const context = getCanvasContext(canvas);
  const point = getPoint(event, canvas);

  canvas.setPointerCapture(event.pointerId);
  inkState.set(canvas, {
    drawing: true,
    x: point.x,
    y: point.y,
  });

  context.beginPath();
  context.moveTo(point.x, point.y);
};

const moveStroke = (event) => {
  const canvas = event.currentTarget;
  const state = inkState.get(canvas);

  if (!state?.drawing) {
    return;
  }

  event.preventDefault();
  const context = getCanvasContext(canvas);
  const point = getPoint(event, canvas);
  context.beginPath();
  context.moveTo(state.x, state.y);
  context.lineTo(point.x, point.y);
  context.stroke();
  state.x = point.x;
  state.y = point.y;
};

const endStroke = (event) => {
  const canvas = event.currentTarget;
  const state = inkState.get(canvas);

  if (state) {
    state.drawing = false;
  }

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
};

const clearInk = () => {
  canvases.forEach((canvas) => {
    const context = getCanvasContext(canvas);
    context.clearRect(0, 0, canvas.width, canvas.height);
  });
  checkButtons.forEach((button) => {
    button.classList.remove("checked");
    button.setAttribute("aria-pressed", "false");
  });
  resetCounts();
};

const renderCount = (key) => {
  const valueElement = document.querySelector(`[data-count-value="${key}"]`);

  if (valueElement) {
    valueElement.textContent = countState[key];
  }
};

const resetCounts = () => {
  Object.keys(countState).forEach((key) => {
    countState[key] = 0;
    renderCount(key);
  });
};

const loadEntries = () => {
  const stored = localStorage.getItem(STORAGE_KEY);

  if (!stored) {
    return [];
  }

  try {
    return JSON.parse(stored);
  } catch {
    return [];
  }
};

const saveEntry = () => {
  const now = getNow();
  const strokes = Object.fromEntries(
    canvases.map((canvas) => [canvas.dataset.field, canvas.toDataURL("image/png")]),
  );
  const entries = loadEntries();

  entries.push({
    id: crypto.randomUUID(),
    savedAt: now.display,
    visitDate: now.date,
    visitTime: now.time,
    checks: Object.fromEntries(
      checkButtons.map((button) => [button.dataset.check, button.classList.contains("checked")]),
    ),
    counts: {
      ...countState,
    },
    strokes,
  });

  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  savedAtText.textContent = now.display;
  completeLayer.classList.add("open");
  completeLayer.setAttribute("aria-hidden", "false");
};

const closeComplete = () => {
  completeLayer.classList.remove("open");
  completeLayer.setAttribute("aria-hidden", "true");
  clearInk();
  updateClock();
};

const setupCanvas = (canvas) => {
  resizeCanvas(canvas);
  canvas.addEventListener("pointerdown", beginStroke);
  canvas.addEventListener("pointermove", moveStroke);
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);
  canvas.addEventListener("pointerleave", endStroke);
};

checkButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const checked = !button.classList.contains("checked");
    button.classList.toggle("checked", checked);
    button.setAttribute("aria-pressed", String(checked));
  });
});

countButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.count;
    countState[key] += 1;
    renderCount(key);
  });
});

clearButton.addEventListener("click", clearInk);
saveButton.addEventListener("click", saveEntry);
nextButton.addEventListener("click", closeComplete);
window.addEventListener("resize", () => {
  canvases.forEach(resizeCanvas);
});

canvases.forEach(setupCanvas);
updateClock();
resetCounts();
setInterval(updateClock, 30_000);
