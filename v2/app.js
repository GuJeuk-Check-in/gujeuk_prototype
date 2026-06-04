const STORAGE_KEY = "gujeuk-typed-registration-v2";

const form = document.querySelector("#visitForm");
const dateText = document.querySelector("#dateText");
const completeLayer = document.querySelector("#completeLayer");
const savedAtText = document.querySelector("#savedAtText");
const nextButton = document.querySelector("#nextButton");

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

const updateDate = () => {
  dateText.textContent = getNow().shortDate;
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

const normalizePhone = (value) => value.replace(/[^\d-]/g, "");

const readForm = () => {
  const formData = new FormData(form);
  const values = Object.fromEntries(formData.entries());

  return {
    name: values.name.trim(),
    age: Number(values.age),
    contact: normalizePhone(values.contact),
    purpose: values.purpose.trim(),
    maleCount: Number(values.maleCount || 0),
    femaleCount: Number(values.femaleCount || 0),
    privacyAgreed: values.privacyAgreed === "on",
  };
};

const resetCounts = () => {
  form.elements.maleCount.value = 0;
  form.elements.femaleCount.value = 0;
};

const saveEntry = (event) => {
  event.preventDefault();

  if (!form.reportValidity()) {
    return;
  }

  const now = getNow();
  const entries = loadEntries();
  const entry = {
    id: crypto.randomUUID(),
    savedAt: now.display,
    visitDate: now.date,
    visitor: readForm(),
  };

  entries.push(entry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));

  savedAtText.textContent = now.display;
  completeLayer.classList.add("open");
  completeLayer.setAttribute("aria-hidden", "false");
};

const closeComplete = () => {
  completeLayer.classList.remove("open");
  completeLayer.setAttribute("aria-hidden", "true");
  form.reset();
  resetCounts();
  updateDate();
};

form.addEventListener("submit", saveEntry);
form.addEventListener("reset", () => {
  window.setTimeout(resetCounts, 0);
});
nextButton.addEventListener("click", closeComplete);

updateDate();
resetCounts();
setInterval(updateDate, 30_000);
