let platesData = [];
let currentSort = { column: "Plate", direction: "asc" };
let dictionaryWords = null;      // Load from words.json
let substitutionMap = null;      // Load substitution_word.json

// Active tag filters (from toggle buttons)
let activeTagFilters = new Set();

const tableBody    = document.getElementById("tableBody");
const searchInput  = document.getElementById("searchInput");
const digitSelect  = document.getElementById("digitSelect");
const premiumSelect = document.getElementById("premiumSelect");  // may be null

const plateHeader  = document.getElementById("plateHeader");
const statusHeader = document.getElementById("statusHeader");

// =======================
// LOAD DICTIONARY (words.json)
// =======================
async function loadDictionary() {
    if (dictionaryWords) return;

    const resp = await fetch("data/words.json");
    const obj = await resp.json();

    dictionaryWords = new Set(Object.keys(obj));  // Words are already uppercase
}

// =======================
// LOAD SUBSTITUTION MAP (substitution_word.json)
// =======================
async function loadSubstitutions() {
    if (substitutionMap) return;

    try {
        const resp = await fetch("data/substitution_word.json");
        substitutionMap = await resp.json(); // { "1NT": ["INT"], "F4ST": ["FAST"], ... }
    } catch (e) {
        console.error("Error loading substitution_word.json:", e);
        substitutionMap = {}; // safe fallback
    }
}

// =======================
// PREMIUM PATTERN DETECTORS
// =======================

// 1. Short plates (1–2 chars)
function isShort(plate) {
    return plate.length <= 2;
}

// 2. Repeats
function isRepeat(plate) {
    if (plate.length < 2) return false;
    const chars = plate.split("");

    if (chars.every(c => c === chars[0])) return true;
    if (plate.length === 4 && chars[0] === chars[1] && chars[2] === chars[3]) return true;
    if (plate.length === 4 && chars[0] === chars[2] && chars[1] === chars[3]) return true;

    return false;
}

// 3. Palindromes
function isPalindrome(plate) {
    if (plate.length < 2) return false;
    const rev = plate.split("").reverse().join("");
    return plate === rev;
}

// 4. Sequences
function isSequence(plate) {
    if (plate.length < 2) return false;

    const isDigits  = /^[0-9]+$/.test(plate);
    const isLetters = /^[A-Z]+$/.test(plate);

    if (!isDigits && !isLetters) return false;

    const vals = plate.split("").map(ch => ch.charCodeAt(0));
    const diffs = [];

    for (let i = 1; i < vals.length; i++) {
        diffs.push(vals[i] - vals[i - 1]);
    }

    return diffs.every(d => d === 1) || diffs.every(d => d === -1);
}

// 5. Lucky patterns
function isLucky(plate) {
    if (/7{2,}|8{2,}/.test(plate)) return true;
    if (/^007$/.test(plate)) return true;
    if (/911/.test(plate)) return true;
    if (/69/.test(plate)) return true;
    if (/420/.test(plate)) return true;
    if (/^777$|^888$|^111$|^222$|^333$|^444$|^555$|^666$|^999$/.test(plate)) return true;
    if (/^0*1$/.test(plate)) return true;

    return false;
}

// 6. Dictionary word
function isWord(plate) {
    if (!dictionaryWords) return false;
    if (!/^[A-Z]+$/.test(plate)) return false;
    return dictionaryWords.has(plate);
}

// 7. Sound-Alikes
const knownGramograms = new Set([
    "B4","2U","4U","L8","L8R","2DAY","2MORO","2MORROW","NE1","NE1E","CU","CYA",
    "GR8","4EVR","4EVER","2L8","10Q","YRU","4N","2FAST4U","2FAST","2QIK","2QIK4U"
]);

function isSound(plate) {
    return knownGramograms.has(plate);
}

// 8. Initials
function isInitials(plate) {
    if (!/^[A-Z]{2,4}$/.test(plate)) return false;
    if (dictionaryWords && dictionaryWords.has(plate)) return false;
    return true;
}

// 9. Word Substitution
function isSubstitutionWord(plate) {
    if (!substitutionMap) return false;
    return substitutionMap.hasOwnProperty(plate);
}

// 10. Numbers Only (all digits)
function isNumbersOnly(plate) {
    return /^[0-9]+$/.test(plate);
}

// 11. Letters Only (A–Z only)
function isLettersOnly(plate) {
    return /^[A-Z]+$/.test(plate);
}

// 12. Pure Number (all digits, no leading zeros)
function isPureNumber(plate) {
    return /^[1-9][0-9]*$/.test(plate);
}

// =======================
// TAG BUILDER
// =======================
function identifyTags(plate) {
    const tags = [];

    if (isShort(plate))            tags.push({ type: "short",        label: "Short" });
    if (isRepeat(plate))           tags.push({ type: "repeat",       label: "Repeat" });
    if (isPalindrome(plate))       tags.push({ type: "palindrome",   label: "Palindrome" });
    if (isSequence(plate))         tags.push({ type: "sequence",     label: "Sequence" });
    if (isLucky(plate))            tags.push({ type: "lucky",        label: "Lucky" });
    if (isWord(plate))             tags.push({ type: "word",         label: "Word" });
    if (isSound(plate))            tags.push({ type: "sound",        label: "Sound-Alike" });
    if (isInitials(plate))         tags.push({ type: "initials",     label: "Initials" });
    if (isSubstitutionWord(plate)) tags.push({ type: "substitution", label: "Word Substitution" });
    if (isNumbersOnly(plate))      tags.push({ type: "numbersonly",  label: "Numbers Only" });
    if (isLettersOnly(plate))      tags.push({ type: "lettersonly",  label: "Letters Only" });
    if (isPureNumber(plate))       tags.push({ type: "purenumber",   label: "Pure Number" });

    return tags;
}

// =======================
// DATA LOADING
// =======================
async function loadPlates() {
    const response = await fetch("data/plates.json");
    const fullData = await response.json();

    platesData = fullData
        .filter(p => p.Status === "Available")
        .map(p => {
            const plate = (p.Plate || "").toUpperCase();
            const tags  = identifyTags(plate);
            return { ...p, Plate: plate, tags };
        });

    renderTable();
}

// =======================
// RENDERING
// =======================
function renderTable() {
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";
    const digits     = digitSelect ? digitSelect.value : "all";
    const dropdownValue = premiumSelect ? premiumSelect.value : "none";

    tableBody.innerHTML = "";

    let filtered = platesData.filter(p => {
        const plate = p.Plate;

        // Text search
        if (!plate.toLowerCase().includes(searchTerm)) return false;

        // Length filter
        if (digits !== "all" && plate.length !== parseInt(digits, 10)) return false;

        // Single dropdown filter (optional)
        if (dropdownValue === "na") {
            if (p.tags.length > 0) return false;
        } else if (dropdownValue !== "none") {
            if (!p.tags.some(t => t.type === dropdownValue)) return false;
        }

        // Multi-tag toggle filtering (require ALL selected tags)
        if (activeTagFilters.size > 0) {
            for (let tag of activeTagFilters) {
                if (!p.tags.some(t => t.type === tag)) return false;
            }
        }

        return true;
    });

    filtered.sort((a, b) => {
        let A = a[currentSort.column];
        let B = b[currentSort.column];
        return currentSort.direction === "asc"
            ? String(A).localeCompare(String(B))
            : String(B).localeCompare(String(A));
    });

    filtered.forEach(p => {
        const tr = document.createElement("tr");
        tr.classList.add("fadeIn");

        // Platinum row for pure numbers
        if (isPureNumber(p.Plate)) {
            tr.classList.add("row-purenumber");
        }

        // Gold row for numbers-only plates
        if (/^[0-9]+$/.test(p.Plate)) {
            tr.classList.add("row-numbersonly");
        }

        const plateTd = document.createElement("td");
        plateTd.textContent = p.Plate;

        const statusTd = document.createElement("td");
        statusTd.textContent = "Available";
        statusTd.classList.add("status-Available");

        const tagTd = document.createElement("td");
        if (p.tags.length === 0) {
            tagTd.textContent = "N/A";
        } else {
            p.tags.forEach(t => {
                const span = document.createElement("span");
                span.classList.add("tag", `tag-${t.type}`);
                span.textContent = t.label;
                tagTd.appendChild(span);
            });
        }

        tr.appendChild(plateTd);
        tr.appendChild(statusTd);
        tr.appendChild(tagTd);
        tableBody.appendChild(tr);
    });
}

// =======================
// EVENTS & INIT
// =======================

// Attach listeners only if elements exist
if (searchInput)  searchInput.addEventListener("input", renderTable);
if (digitSelect)  digitSelect.addEventListener("change", renderTable);
if (premiumSelect) premiumSelect.addEventListener("change", renderTable);

if (plateHeader)  plateHeader.addEventListener("click", () => toggleSort("Plate"));
if (statusHeader) statusHeader.addEventListener("click", () => toggleSort("Status"));

// Tag filter buttons
document.querySelectorAll(".tag-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const tag = btn.getAttribute("data-tag");

        if (tag === "clear") {
            activeTagFilters.clear();
            document.querySelectorAll(".tag-filter-btn").forEach(b => b.classList.remove("active"));
        } else {
            if (activeTagFilters.has(tag)) {
                activeTagFilters.delete(tag);
                btn.classList.remove("active");
            } else {
                activeTagFilters.add(tag);
                btn.classList.add("active");
            }
        }

        renderTable();
    });
});

function toggleSort(column) {
    if (currentSort.column === column) {
        currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
    } else {
        currentSort.column = column;
        currentSort.direction = "asc";
    }
    renderTable();
}

(async function init() {
    await loadDictionary();
    await loadSubstitutions();
    await loadPlates();
})();
