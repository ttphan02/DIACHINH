// Application State Central Management
let currentPdfBytes = null;
let currentPdfDoc = null;
let originalFileName = 'tai-lieu';
let totalPages = 0;
let selectedPagesMap = new Map(); // pageIndex (1-based) => boolean
let pageRotationMap = new Map();  // pageIndex (1-based) => angle (0, 90, 180, 270)
let replacedPagesMap = new Map(); // pageIndex (1-based) => { type: 'pdf'|'image', pdfjsDoc, pdfLibDoc, filename, dataUrl, bytes }
let targetReplacePageNum = null;

let pdfGroups = [];

// Google Sheet Cache
let cachedSheetData = null;
let cachedSheetTime = 0;

// Gemini State
let geminiKeys = [...DEFAULT_GEMINI_KEYS];
let currentGeminiKeyIdx = 0;
let isGeminiQuotaExhausted = false;

// CCCD Files Map
let loadedCccdFilesMap = new Map(); // cleanKey => File
let cccd12DigitMap = new Map();     // 12digitCode => File
let targetCccdGroupId = null;

// Thumbnail Lazy Render Queue
let renderedPagesSet = new Set();
let renderQueue = [];
let activeRenderCount = 0;
let pageRenderObserver = null;
