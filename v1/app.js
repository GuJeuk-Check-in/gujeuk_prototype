const STORAGE_KEY = "gujeuk-handwritten-ledger-v1";
const DATABASE_NAME = "gujeuk-prototype-v1-resilient";
const DATABASE_VERSION = 1;
const PURPOSE_CACHE_KEY = "purpose-cache";
const IS_LOCAL_DEVELOPMENT = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const API_BASE_URL = IS_LOCAL_DEVELOPMENT ? "https://api.taisu.site" : "/backend";
const PURPOSE_API_URL = `${API_BASE_URL}/purpose/all`;
const SUBMISSION_API_URL = `${API_BASE_URL}/user/sign-up`;
const API_TIMEOUT_MS = 8_000;
const RECOGNITION_TIMEOUT_MS = 6_000;
const SYNC_INTERVAL_MS = 30_000;
const PURPOSE_PENDING_VALUE = "__PURPOSE_CONFIRMATION_REQUIRED__";

const canvases = [...document.querySelectorAll(".ink-canvas")];
const dateCell = document.querySelector("#dateCell");
const systemStatus = document.querySelector("#systemStatus");
const purposeStatus = document.querySelector("#purposeStatus");
const syncStatus = document.querySelector("#syncStatus");
const retrySyncButton = document.querySelector("#retrySyncButton");
const purposeOptions = document.querySelector("#purposeOptions");
const checkButtons = [...document.querySelectorAll(".check-cell")];
const clearButton = document.querySelector("#clearButton");
const saveButton = document.querySelector("#saveButton");
const reviewLayer = document.querySelector("#reviewLayer");
const reviewForm = document.querySelector("#reviewForm");
const reviewDateText = document.querySelector("#reviewDateText");
const recognitionMessage = document.querySelector("#recognitionMessage");
const saveDataPreview = document.querySelector("#saveDataPreview");
const editHandwritingButton = document.querySelector("#editHandwritingButton");
const skipRecognitionButton = document.querySelector("#skipRecognitionButton");
const finalSaveButton = document.querySelector("#finalSaveButton");
const completeLayer = document.querySelector("#completeLayer");
const savedAtText = document.querySelector("#savedAtText");
const submissionStatusText = document.querySelector("#submissionStatusText");
const nextButton = document.querySelector("#nextButton");

const inkState = new WeakMap();
let pendingEntry = null;
let selectedPurpose = "";
let currentPurposes = [];
let databasePromise = null;
let syncPromise = null;
let recognitionAbortController = null;
let recognitionRunId = 0;

const pad = (value) => String(value).padStart(2, "0");

const getNow = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());

  return {
    date: `${year}-${month}-${day}`,
    shortDate: `${Number(month)}/${Number(day)}`,
    display: `${year}.${month}.${day}`,
  };
};

const openDatabase = () => {
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;

      if (!database.objectStoreNames.contains("settings")) {
        database.createObjectStore("settings", { keyPath: "key" });
      }

      if (!database.objectStoreNames.contains("submissions")) {
        const store = database.createObjectStore("submissions", { keyPath: "id" });
        store.createIndex("status", "status");
        store.createIndex("createdAt", "createdAt");
      }
    });

    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });

  return databasePromise;
};

const runDatabaseRequest = async (storeName, mode, operation) => {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = operation(store);

    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
    transaction.addEventListener("abort", () => reject(transaction.error));
  });
};

const getSetting = (key) => runDatabaseRequest("settings", "readonly", (store) => store.get(key));

const putSetting = (value) =>
  runDatabaseRequest("settings", "readwrite", (store) => store.put(value));

const putSubmission = (value) =>
  runDatabaseRequest("submissions", "readwrite", (store) => store.put(value));

const getSubmissions = () =>
  runDatabaseRequest("submissions", "readonly", (store) => store.getAll());

const requestPersistentStorage = async () => {
  if (!navigator.storage?.persist) {
    return false;
  }

  return navigator.storage.persist();
};

const updateClock = () => {
  const now = getNow();
  dateCell.textContent = now.shortDate;
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
  redrawCanvas(canvas);
};

const getPoint = (event, canvas) => {
  const rect = canvas.getBoundingClientRect();

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
};

const toNormalizedPoint = (point, canvas) => {
  const rect = canvas.getBoundingClientRect();

  return {
    x: rect.width ? point.x / rect.width : 0,
    y: rect.height ? point.y / rect.height : 0,
  };
};

const redrawCanvas = (canvas) => {
  const state = inkState.get(canvas);

  if (!state?.strokes.length) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const context = getCanvasContext(canvas);

  state.strokes.forEach((stroke) => {
    if (stroke.x.length < 2) {
      return;
    }

    context.beginPath();
    context.moveTo(stroke.x[0] * rect.width, stroke.y[0] * rect.height);

    for (let index = 1; index < stroke.x.length; index += 1) {
      context.lineTo(stroke.x[index] * rect.width, stroke.y[index] * rect.height);
    }

    context.stroke();
  });
};

const beginStroke = (event) => {
  event.preventDefault();
  const canvas = event.currentTarget;
  const context = getCanvasContext(canvas);
  const point = getPoint(event, canvas);
  const normalizedPoint = toNormalizedPoint(point, canvas);
  const state = inkState.get(canvas);
  const stroke = {
    x: [normalizedPoint.x],
    y: [normalizedPoint.y],
    t: [0],
  };

  canvas.setPointerCapture(event.pointerId);
  state.drawing = true;
  state.x = point.x;
  state.y = point.y;
  state.startedAt = performance.now();
  state.activeStroke = stroke;
  state.strokes.push(stroke);

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
  const normalizedPoint = toNormalizedPoint(point, canvas);
  context.beginPath();
  context.moveTo(state.x, state.y);
  context.lineTo(point.x, point.y);
  context.stroke();
  state.activeStroke.x.push(normalizedPoint.x);
  state.activeStroke.y.push(normalizedPoint.y);
  state.activeStroke.t.push(Math.round(performance.now() - state.startedAt));
  state.x = point.x;
  state.y = point.y;
};

const endStroke = (event) => {
  const canvas = event.currentTarget;
  const state = inkState.get(canvas);

  if (state) {
    state.drawing = false;
    state.activeStroke = null;
  }

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
};

const clearInk = () => {
  canvases.forEach((canvas) => {
    const context = getCanvasContext(canvas);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const state = inkState.get(canvas);
    state.strokes = [];
    state.activeStroke = null;
    state.drawing = false;
  });
  checkButtons.forEach((button) => {
    button.classList.remove("checked");
    button.setAttribute("aria-pressed", "false");
  });
  selectedPurpose = "";
  renderPurposeOptions();
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

const setStatusText = (element, message, state = "") => {
  element.textContent = message;
  element.className = state;
};

const normalizePurposes = (responseBody) => {
  const items = Array.isArray(responseBody) ? responseBody : responseBody?.data;

  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item, index) => {
      if (typeof item === "string") {
        return { id: `legacy-${index}-${item}`, purpose: item.trim() };
      }

      return {
        id: item?.id ?? `purpose-${index}`,
        purpose: String(item?.purpose ?? item?.name ?? "").trim(),
      };
    })
    .filter((item) => item.purpose);
};

const getLegacyPurposes = () => {
  const purposes = loadEntries()
    .map((entry) => entry?.recognized?.purpose)
    .filter(Boolean);

  return [...new Set(purposes)].map((purpose, index) => ({
    id: `saved-${index}-${purpose}`,
    purpose,
  }));
};

const populateReviewPurposeSelect = () => {
  const select = reviewForm.elements.purpose;
  const selectedValue = select.value || selectedPurpose;
  const options = [new Option("방문목적을 선택해주세요.", "")];

  currentPurposes.forEach((item) => {
    options.push(new Option(item.purpose, item.purpose));
  });

  if (selectedValue === PURPOSE_PENDING_VALUE) {
    options.push(new Option("방문목적 목록 복구 후 확인 필요", PURPOSE_PENDING_VALUE));
  }

  select.replaceChildren(...options);
  select.value =
    currentPurposes.some((item) => item.purpose === selectedValue) ||
    selectedValue === PURPOSE_PENDING_VALUE
      ? selectedValue
      : "";
};

const renderPurposeOptions = () => {
  if (
    selectedPurpose &&
    !currentPurposes.some((item) => item.purpose === selectedPurpose)
  ) {
    selectedPurpose = "";
  }

  if (!currentPurposes.length) {
    selectedPurpose = PURPOSE_PENDING_VALUE;
    const message = document.createElement("button");
    message.type = "button";
    message.className = "purpose-option selected";
    message.textContent = "목록 복구 후 확인 필요";
    message.setAttribute("aria-pressed", "true");
    purposeOptions.replaceChildren(message);
    saveButton.disabled = false;
    populateReviewPurposeSelect();
    return;
  }

  const buttons = currentPurposes.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `purpose-option${item.purpose === selectedPurpose ? " selected" : ""}`;
    button.textContent = item.purpose;
    button.setAttribute("aria-pressed", String(item.purpose === selectedPurpose));
    button.addEventListener("click", () => {
      selectedPurpose = item.purpose;
      renderPurposeOptions();
    });
    return button;
  });

  purposeOptions.replaceChildren(...buttons);
  saveButton.disabled = false;
  populateReviewPurposeSelect();
};

const fetchWithTimeout = async (url, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const loadPurposes = async () => {
  const cachedSetting = await getSetting(PURPOSE_CACHE_KEY).catch(() => null);
  const cachedPurposes = normalizePurposes(cachedSetting?.value);
  const legacyPurposes = cachedPurposes.length ? [] : getLegacyPurposes();
  const fallbackPurposes = cachedPurposes.length ? cachedPurposes : legacyPurposes;

  if (fallbackPurposes.length) {
    currentPurposes = fallbackPurposes;
    renderPurposeOptions();
    setStatusText(purposeStatus, "방문목적: 저장된 목록을 먼저 표시했습니다.", "warning");
  }

  try {
    const response = await fetchWithTimeout(PURPOSE_API_URL, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`방문목적 조회 실패: ${response.status}`);
    }

    const purposes = normalizePurposes(await response.json());

    if (!purposes.length) {
      throw new Error("방문목적 목록이 비어 있습니다.");
    }

    currentPurposes = purposes;
    await putSetting({
      key: PURPOSE_CACHE_KEY,
      value: purposes,
      updatedAt: new Date().toISOString(),
    });
    renderPurposeOptions();
    setStatusText(purposeStatus, "방문목적: 서버의 최신 목록 사용 중");
  } catch (error) {
    console.warn(error);

    if (fallbackPurposes.length) {
      currentPurposes = fallbackPurposes;
      renderPurposeOptions();
      setStatusText(purposeStatus, "방문목적: 서버 장애로 이전 목록 사용 중", "warning");
    } else {
      currentPurposes = [];
      renderPurposeOptions();
      setStatusText(
        purposeStatus,
        "방문목적: 이전 목록이 없어 확인 필요 상태로 저장합니다.",
        "warning",
      );
    }
  }
};

const captureHandwriting = () => {
  const now = getNow();
  const strokes = Object.fromEntries(
    canvases.map((canvas) => [canvas.dataset.field, canvas.toDataURL("image/png")]),
  );
  const ink = Object.fromEntries(
    canvases.map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      const state = inkState.get(canvas);
      const fieldInk = state.strokes.map((stroke) => [
        stroke.x.map((value) => Math.round(value * rect.width)),
        stroke.y.map((value) => Math.round(value * rect.height)),
        stroke.t,
      ]);

      return [
        canvas.dataset.field,
        {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          strokes: fieldInk,
        },
      ];
    }),
  );

  return {
    id: crypto.randomUUID(),
    savedAt: now.display,
    visitDate: now.date,
    checks: Object.fromEntries(
      checkButtons.map((button) => [button.dataset.check, button.classList.contains("checked")]),
    ),
    strokes,
    ink,
    selectedPurpose,
  };
};

const emptyRecognition = (entry = pendingEntry) => ({
  name: entry?.recognized?.name ?? "",
  age: entry?.recognized?.age ?? "",
  contact: entry?.recognized?.contact ?? "",
  purpose:
    entry?.recognized?.purpose ?? entry?.selectedPurpose ?? selectedPurpose,
  maleCount: entry?.recognized?.maleCount ?? "",
  femaleCount: entry?.recognized?.femaleCount ?? "",
  privacyAgreed:
    entry?.recognized?.privacyAgreed ?? entry?.checks?.privacyAgreed ?? false,
});

const selectRecognitionCandidate = (field, candidates) => {
  if (!candidates.length) {
    return "";
  }

  if (["age", "maleCount", "femaleCount"].includes(field)) {
    const numericCandidate = candidates
      .map((candidate) => candidate.replace(/\D/g, ""))
      .find((candidate) => candidate.length > 0 && candidate.length <= 3);
    return numericCandidate || "";
  }

  if (field === "contact") {
    const numericCandidates = candidates
      .map((candidate) => candidate.replace(/\D/g, ""))
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
    return numericCandidates[0] || "";
  }

  return candidates[0].trim();
};

const recognizeHandwriting = async (entry = pendingEntry, signal) => {
  const recognition = emptyRecognition(entry);
  const fields = Object.entries(entry.ink).filter(([, value]) => value.strokes.length > 0);

  if (!fields.length) {
    return recognition;
  }

  const requests = fields.map(([, value]) => ({
    writing_guide: {
      writing_area_width: Math.max(value.width, 1),
      writing_area_height: Math.max(value.height, 1),
    },
    ink: value.strokes,
    language: "ko",
  }));

  const response = await fetch(
    "https://inputtools.google.com/request?itc=ko-t-i0-handwrit&app=gujeuk-prototype",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal,
      body: JSON.stringify({
        options: "enable_pre_space",
        requests,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`필기 인식 요청 실패: ${response.status}`);
  }

  const result = await response.json();

  if (result[0] !== "SUCCESS" || !Array.isArray(result[1])) {
    throw new Error("필기 인식 결과를 읽을 수 없습니다.");
  }

  result[1].forEach((item, index) => {
    const field = fields[index][0];
    const candidates = Array.isArray(item?.[1]) ? item[1] : [];
    recognition[field] = selectRecognitionCandidate(field, candidates);
  });

  return recognition;
};

const fillReviewForm = (recognized) => {
  reviewDateText.textContent = pendingEntry.savedAt;
  reviewForm.elements.name.value = recognized.name;
  reviewForm.elements.age.value = recognized.age;
  reviewForm.elements.contact.value = recognized.contact;
  reviewForm.elements.purpose.value = recognized.purpose;
  reviewForm.elements.maleCount.value = recognized.maleCount;
  reviewForm.elements.femaleCount.value = recognized.femaleCount;
  reviewForm.elements.privacyAgreed.checked = recognized.privacyAgreed;

  renderSavePreview();
};

const setRecognitionState = (state, message) => {
  const isLoading = state === "loading";
  reviewForm.setAttribute("aria-busy", String(isLoading));
  recognitionMessage.className = `recognition-message ${state}`;
  recognitionMessage.textContent = message;
  [...reviewForm.elements].forEach((element) => {
    if (element !== editHandwritingButton && element !== skipRecognitionButton) {
      element.disabled = isLoading;
    }
  });
  skipRecognitionButton.classList.toggle("visible", isLoading);
  finalSaveButton.textContent = isLoading ? "인식 중..." : "최종 저장";
};

const continueWithoutRecognition = () => {
  recognitionRunId += 1;
  recognitionAbortController?.abort();
  recognitionAbortController = null;
  setRecognitionState(
    "offline",
    "인식을 건너뛰었습니다. 값이 비어 있어도 원본 필기와 획 데이터는 그대로 저장됩니다.",
  );
};

const openReview = async () => {
  if (!selectedPurpose) {
    setStatusText(purposeStatus, "방문목적을 먼저 선택해주세요.", "error");
    return;
  }

  pendingEntry = captureHandwriting();
  fillReviewForm(emptyRecognition());
  reviewLayer.classList.add("open");
  reviewLayer.setAttribute("aria-hidden", "false");

  if (!navigator.onLine) {
    continueWithoutRecognition();
    return;
  }

  const currentRunId = recognitionRunId + 1;
  recognitionRunId = currentRunId;
  recognitionAbortController = new AbortController();
  const recognitionTimeout = setTimeout(
    () => recognitionAbortController?.abort(),
    RECOGNITION_TIMEOUT_MS,
  );
  setRecognitionState("loading", "작성한 필기를 인식하고 있습니다. 잠시만 기다려주세요.");

  try {
    const recognized = await recognizeHandwriting(
      pendingEntry,
      recognitionAbortController.signal,
    );

    if (currentRunId !== recognitionRunId) {
      return;
    }

    fillReviewForm(recognized);
    setRecognitionState("success", "인식이 완료되었습니다. 틀린 부분이 있으면 직접 수정해주세요.");
  } catch (error) {
    if (currentRunId !== recognitionRunId) {
      return;
    }

    console.warn(error);
    setRecognitionState(
      "offline",
      "인식 서버에 연결할 수 없습니다. 원본 필기는 그대로 저장되며 나중에 다시 처리됩니다.",
    );
  } finally {
    clearTimeout(recognitionTimeout);

    if (currentRunId === recognitionRunId) {
      recognitionAbortController = null;
    }
  }
};

const closeReview = () => {
  recognitionRunId += 1;
  recognitionAbortController?.abort();
  recognitionAbortController = null;
  reviewLayer.classList.remove("open");
  reviewLayer.setAttribute("aria-hidden", "true");
};

const readReviewedData = () => ({
  name: reviewForm.elements.name.value.trim(),
  age: reviewForm.elements.age.value ? Number(reviewForm.elements.age.value) : "",
  contact: reviewForm.elements.contact.value.trim(),
  purpose: reviewForm.elements.purpose.value.trim(),
  maleCount: reviewForm.elements.maleCount.value ? Number(reviewForm.elements.maleCount.value) : "",
  femaleCount: reviewForm.elements.femaleCount.value ? Number(reviewForm.elements.femaleCount.value) : "",
  privacyAgreed: reviewForm.elements.privacyAgreed.checked,
});

const buildSavePreview = () => {
  if (!pendingEntry) {
    return null;
  }

  return {
    id: pendingEntry.id,
    savedAt: pendingEntry.savedAt,
    visitDate: pendingEntry.visitDate,
    checks: pendingEntry.checks,
    strokes: Object.fromEntries(
      Object.keys(pendingEntry.strokes).map((field) => [field, "[필기 이미지]"]),
    ),
    recognized: readReviewedData(),
  };
};

const renderSavePreview = () => {
  const preview = buildSavePreview();

  if (!preview) {
    saveDataPreview.replaceChildren();
    return;
  }

  const recognized = preview.recognized;
  const purposeDisplay =
    recognized.purpose === PURPOSE_PENDING_VALUE
      ? "목록 복구 후 확인 필요"
      : recognized.purpose || "미입력";
  const rows = [
    ["방문 날짜", preview.visitDate],
    ["이름", recognized.name || "미입력"],
    ["나이", recognized.age === "" ? "미입력" : `${recognized.age}세`],
    ["연락처", recognized.contact || "미입력"],
    ["방문 목적", purposeDisplay, "wide"],
    [
      "동행인 수",
      `남자 ${recognized.maleCount === "" ? 0 : recognized.maleCount}명 · 여자 ${
        recognized.femaleCount === "" ? 0 : recognized.femaleCount
      }명`,
      "wide",
    ],
    ["개인정보 동의", recognized.privacyAgreed ? "동의" : "미동의", "wide"],
  ];

  const fragments = rows.map(([label, value, className]) => {
    const row = document.createElement("div");
    const labelElement = document.createElement("span");
    const valueElement = document.createElement("strong");

    row.className = `save-data-row${className ? ` ${className}` : ""}`;
    labelElement.textContent = label;
    valueElement.textContent = value;
    row.append(labelElement, valueElement);
    return row;
  });

  saveDataPreview.replaceChildren(...fragments);
};

const buildServerPayload = (entry) => ({
  clientRequestId: entry.id,
  capturedAt: entry.capturedAt,
  visitDate: entry.visitDate,
  name: entry.recognized.name,
  age: entry.recognized.age,
  phone: entry.recognized.contact,
  purpose: entry.recognized.purpose,
  maleCount: entry.recognized.maleCount === "" ? 0 : entry.recognized.maleCount,
  femaleCount: entry.recognized.femaleCount === "" ? 0 : entry.recognized.femaleCount,
  privacyAgreed: entry.recognized.privacyAgreed,
});

const hasRequiredRecognizedData = (recognized) =>
  Boolean(
    recognized.name &&
      recognized.age !== "" &&
      recognized.contact &&
      recognized.purpose &&
      recognized.purpose !== PURPOSE_PENDING_VALUE,
  );

const getInitialSubmissionStatus = (entry) => {
  if (entry.recognized.purpose === PURPOSE_PENDING_VALUE) {
    return "awaiting-purpose";
  }

  if (!hasRequiredRecognizedData(entry.recognized)) {
    return "awaiting-recognition";
  }

  return "pending";
};

const mergeRecognition = (current, recognized) => {
  const merged = { ...current };

  Object.entries(recognized).forEach(([field, value]) => {
    if ((merged[field] === "" || merged[field] == null) && value !== "") {
      merged[field] = value;
    }
  });

  return merged;
};

const prepareSubmissionForSync = async (submission) => {
  if (submission.status === "awaiting-purpose" || submission.status === "needs-review") {
    return submission;
  }

  if (
    submission.status !== "awaiting-recognition" &&
    hasRequiredRecognizedData(submission.localData.recognized)
  ) {
    return submission;
  }

  try {
    const recognized = await recognizeHandwriting(submission.localData);
    const mergedRecognition = mergeRecognition(
      submission.localData.recognized,
      recognized,
    );
    const localData = {
      ...submission.localData,
      recognized: mergedRecognition,
      recognitionStatus: hasRequiredRecognizedData(mergedRecognition)
        ? "complete"
        : "pending",
    };
    const preparedSubmission = {
      ...submission,
      localData,
      payload: buildServerPayload(localData),
      status: hasRequiredRecognizedData(mergedRecognition)
        ? "pending"
        : "awaiting-recognition",
      lastRecognitionAttemptAt: new Date().toISOString(),
      lastRecognitionError: null,
    };
    await putSubmission(preparedSubmission);
    return preparedSubmission;
  } catch (error) {
    const waitingSubmission = {
      ...submission,
      status: "awaiting-recognition",
      lastRecognitionAttemptAt: new Date().toISOString(),
      lastRecognitionError: error.message,
    };
    await putSubmission(waitingSubmission);
    return waitingSubmission;
  }
};

const updateSyncStatus = async () => {
  const submissions = await getSubmissions().catch(() => []);
  const pendingCount = submissions.filter((item) => item.status !== "synced").length;

  if (submissions.length === 0) {
    setStatusText(syncStatus, "등록 데이터: 저장 대기 없음");
    return;
  }

  if (pendingCount === 0) {
    setStatusText(syncStatus, "등록 데이터: 모두 서버에 저장됨");
    return;
  }

  setStatusText(
    syncStatus,
    `등록 데이터: ${pendingCount}건 기기에 안전하게 보관 중`,
    "warning",
  );
};

const sendSubmission = async (submission) => {
  const response = await fetchWithTimeout(SUBMISSION_API_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": submission.id,
      "X-Client-Request-Id": submission.id,
    },
    body: JSON.stringify(submission.payload),
  });

  const responseText = await response.text();
  let responseBody = null;

  if (responseText) {
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = responseText;
    }
  }

  if (!response.ok) {
    const error = new Error(`등록 API 실패: ${response.status}`);
    error.status = response.status;
    error.responseBody = responseBody;
    throw error;
  }

  return responseBody;
};

const syncSubmission = async (submission) => {
  const syncingSubmission = {
    ...submission,
    status: "syncing",
    attempts: submission.attempts + 1,
    lastAttemptAt: new Date().toISOString(),
  };
  await putSubmission(syncingSubmission);

  try {
    const serverResponse = await sendSubmission(syncingSubmission);
    const syncedSubmission = {
      ...syncingSubmission,
      status: "synced",
      syncedAt: new Date().toISOString(),
      lastError: null,
      serverResponse,
    };
    await putSubmission(syncedSubmission);
    return syncedSubmission;
  } catch (error) {
    const needsReview = error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
    const failedSubmission = {
      ...syncingSubmission,
      status: needsReview ? "needs-review" : "pending",
      lastError: {
        message: error.message,
        status: error.status ?? null,
        responseBody: error.responseBody ?? null,
      },
    };
    await putSubmission(failedSubmission);
    return failedSubmission;
  }
};

const syncPendingSubmissions = async ({ force = false } = {}) => {
  if (syncPromise) {
    return syncPromise;
  }

  syncPromise = (async () => {
    if (!navigator.onLine) {
      await updateSyncStatus();
      return;
    }

    const submissions = await getSubmissions();
    const candidates = submissions
      .filter((item) => item.status !== "synced")
      .filter((item) => force || item.status !== "needs-review")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    for (const submission of candidates) {
      const preparedSubmission = await prepareSubmissionForSync(submission);

      if (preparedSubmission.status !== "pending") {
        continue;
      }

      await syncSubmission(preparedSubmission);
    }

    await updateSyncStatus();
  })()
    .catch((error) => {
      console.error(error);
      setStatusText(syncStatus, "등록 데이터: 기기 저장소를 확인할 수 없습니다.", "error");
    })
    .finally(() => {
      syncPromise = null;
    });

  return syncPromise;
};

const saveReviewedEntry = async (event) => {
  event.preventDefault();

  if (!pendingEntry) {
    return;
  }

  const entry = buildSavePreview();
  entry.strokes = pendingEntry.strokes;
  entry.ink = pendingEntry.ink;
  entry.capturedAt = new Date().toISOString();
  entry.recognitionStatus = hasRequiredRecognizedData(entry.recognized)
    ? "complete"
    : "pending";

  const submission = {
    id: entry.id,
    createdAt: entry.capturedAt,
    status: getInitialSubmissionStatus(entry),
    attempts: 0,
    payload: buildServerPayload(entry),
    localData: entry,
    lastError: null,
    serverResponse: null,
  };

  try {
    await putSubmission(submission);
  } catch (error) {
    console.error(error);
    setRecognitionState("error", "기기 저장소에 기록하지 못했습니다. 다시 시도해주세요.");
    return;
  }

  savedAtText.textContent = pendingEntry.savedAt;
  submissionStatusText.textContent =
    submission.status === "awaiting-purpose"
      ? "방문목적 확인 필요 상태로 원본 필기 전체를 기기에 저장했습니다."
      : submission.status === "awaiting-recognition"
        ? "인식되지 않은 원본 필기 전체를 기기에 저장했습니다."
        : "기기에 안전하게 저장했습니다. 서버 전송을 시도합니다.";
  pendingEntry = null;
  closeReview();
  completeLayer.classList.add("open");
  completeLayer.setAttribute("aria-hidden", "false");
  updateSyncStatus();

  syncPendingSubmissions().then(async () => {
    const syncedSubmission = (await getSubmissions()).find((item) => item.id === submission.id);

    if (syncedSubmission?.status === "synced") {
      submissionStatusText.textContent = "서버 저장까지 완료되었습니다.";
    } else if (syncedSubmission?.status === "awaiting-purpose") {
      submissionStatusText.textContent =
        "방문목적 목록 복구 후 확인할 수 있도록 모든 원본 데이터를 기기에 보관 중입니다.";
    } else if (syncedSubmission?.status === "awaiting-recognition") {
      submissionStatusText.textContent =
        "원본 필기를 기기에 보관 중입니다. 연결되면 인식 후 서버 전송을 다시 시도합니다.";
    } else if (syncedSubmission?.status === "needs-review") {
      submissionStatusText.textContent =
        "기기에는 안전하게 저장했지만 서버 요청 형식을 확인해야 합니다. 데이터는 삭제되지 않습니다.";
    } else {
      submissionStatusText.textContent =
        "서버 장애로 기기에 안전하게 보관 중입니다. 연결되면 자동으로 다시 전송합니다.";
    }

    await updateSyncStatus();
  });
};

const closeComplete = () => {
  completeLayer.classList.remove("open");
  completeLayer.setAttribute("aria-hidden", "true");
  clearInk();
  updateClock();
};

const setupCanvas = (canvas) => {
  inkState.set(canvas, {
    drawing: false,
    x: 0,
    y: 0,
    startedAt: 0,
    activeStroke: null,
    strokes: [],
  });
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

clearButton.addEventListener("click", clearInk);
saveButton.addEventListener("click", openReview);
reviewForm.addEventListener("submit", saveReviewedEntry);
reviewForm.addEventListener("input", renderSavePreview);
reviewForm.addEventListener("change", renderSavePreview);
editHandwritingButton.addEventListener("click", closeReview);
skipRecognitionButton.addEventListener("click", continueWithoutRecognition);
nextButton.addEventListener("click", closeComplete);
retrySyncButton.addEventListener("click", () => {
  setStatusText(purposeStatus, "방문목적: 서버에 다시 연결하는 중");
  setStatusText(syncStatus, "등록 데이터: 서버에 다시 전송하는 중");
  Promise.all([loadPurposes(), syncPendingSubmissions({ force: true })]);
});
window.addEventListener("online", () => {
  loadPurposes();
  syncPendingSubmissions();
});
window.addEventListener("offline", () => {
  setStatusText(
    syncStatus,
    "등록 데이터: 오프라인 상태, 기기에 안전하게 보관합니다.",
    "warning",
  );
});
window.addEventListener("resize", () => {
  canvases.forEach(resizeCanvas);
});
window.addEventListener("load", () => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js?v=3").catch((error) => {
      console.warn("오프라인 화면 캐시를 등록하지 못했습니다.", error);
    });
  }
});

canvases.forEach(setupCanvas);
updateClock();
loadPurposes();
updateSyncStatus();
syncPendingSubmissions();
requestPersistentStorage();
setInterval(updateClock, 30_000);
setInterval(syncPendingSubmissions, SYNC_INTERVAL_MS);
