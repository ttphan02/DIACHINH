const stripAccentsCache = new Map<string, string>();
const MAX_STRIP_ACCENTS_CACHE = 25000;

export function stripAccents(text: string): string {
  if (!text) return '';
  const cached = stripAccentsCache.get(text);
  if (cached !== undefined) return cached;

  const result = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .trim();

  if (stripAccentsCache.size >= MAX_STRIP_ACCENTS_CACHE) {
    stripAccentsCache.clear();
  }
  stripAccentsCache.set(text, result);
  return result;
}

// Chuẩn hóa CCCD (12 chữ số)
export function cleanCccd(val: any): string {
  if (!val) return '';
  const s = String(val).trim().replace(/\.0$/, '');
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 9 && digits.length <= 12) {
    return digits.padStart(12, '0');
  }
  return digits;
}

// Lọc và loại bỏ toàn bộ danh xưng như: Ông, Bà, Hộ ông, Hộ bà, Hộ, Vợ chồng ông...
export function stripHonorifics(name: any): string {
  if (!name) return '';
  let s = String(name).trim();

  // Pattern khớp các tiền tố danh xưng ở đầu chuỗi (kể cả có dấu hai chấm, gạch nối, dấu phẩy)
  // Ví dụ: "Hộ gia đình ông", "Hộ ông", "Hộ bà", "Vợ chồng ông", "Hộ:", "Ông", "Bà",...
  const honorificRegex = /^(hộ\s+gia\s+đình\s+(ông|bà)?|hộ\s+gđ\s+(ông|bà)?|hộ\s+gđ|vợ\s+chồng\s+(ông|bà)?|vợ\s+chồng|hộ\s+(ông|bà)|hộ|ông|bà|ong|ba|ho\s+ong|ho\s+ba|ho|anh|chị|cô|chú|bác)[\s:,\.\-_/]+/i;

  let prev = '';
  // Lặp để xử lý trường hợp lồng nhau, vd: "Hộ: Ông Nguyễn Văn A" -> "Ông Nguyễn Văn A" -> "Nguyễn Văn A"
  while (s !== prev && honorificRegex.test(s)) {
    prev = s;
    s = s.replace(honorificRegex, '').trim();
  }

  // Trường hợp từ đầu tiên là Ông / Bà đứng riêng: "Ông Nguyễn Văn A"
  s = s.replace(/^(ông|bà|ong|ba|hộ|ho)\s+/i, '').trim();

  return s;
}

// Chuẩn hóa vị trí dấu thanh nguyên âm tiếng Việt (òa vs oà, úy vs uý) nhưng TUYỆT ĐỐI GIỮ NGUYÊN DẤU THANH
export function normalizeVietnameseVowels(s: string): string {
  if (!s) return '';
  const replacements: Record<string, string> = {
    'oà': 'òa', 'oá': 'óa', 'oả': 'ỏa', 'oã': 'õa', 'oạ': 'ọa',
    'uỳ': 'ùy', 'uý': 'úy', 'uỷ': 'ủy', 'uỹ': 'ũy', 'uỵ': 'ụy',
    'oè': 'òe', 'oé': 'óe', 'oẻ': 'ỏe', 'oẽ': 'õe', 'oẹ': 'ọe',
  };
  let res = s.normalize('NFC').toLowerCase();
  for (const [k, v] of Object.entries(replacements)) {
    res = res.replace(new RegExp(k, 'g'), v);
  }
  return res;
}

// Chuẩn hóa tên CHÍNH XÁC TỪNG DẤU THANH (Quang != Quảng, Ba != Bảy, Anh != Ánh, Vàng != Vang)
// Đồng thời đưa về chữ thường để so sánh không phân biệt HOA / thường
export function cleanStrictName(name: any): string {
  if (!name) return '';
  let s = normalizeVietnameseVowels(stripHonorifics(name));
  s = s.replace(/['’`"]/g, '');
  s = s.replace(/\s+/g, ' ');
  return s.trim().toLowerCase();
}

// Chuẩn hóa tên (lọc bỏ toàn bộ danh xưng, bỏ dấu cách thừa, viết hoa chữ cái đầu từng từ)
export function cleanName(name: any): string {
  if (!name) return '';
  const stripped = stripHonorifics(name);
  return stripped
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// Làm sạch danh xưng trong mô tả tứ cận (giáp ranh)
export function cleanBoundaryText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\b(hộ\s+ông|hộ\s+bà|vợ\s+chồng\s+ông|vợ\s+chồng\s+bà|ông|bà)\s+/gi, '')
    .trim();
}

// 4 tùy chọn nguồn gốc sử dụng đất chuẩn hóa
export const NGUON_GOC_OPTIONS = [
  'Khai Hoang',
  'Thừa Kế',
  'Tặng Cho',
  'Chuyển Nhượng',
] as const;

export type NguonGocChuan = typeof NGUON_GOC_OPTIONS[number];

// Chuẩn hóa nguồn gốc sử dụng đất về 1 trong 4 nhóm
export function normalizeNguonGoc(val?: string): NguonGocChuan {
  if (!val) return 'Khai Hoang';
  const s = stripAccents(val).toLowerCase();
  if (s.includes('thua ke')) return 'Thừa Kế';
  if (s.includes('tang cho')) return 'Tặng Cho';
  if (s.includes('chuyen nhuong')) return 'Chuyển Nhượng';
  return 'Khai Hoang';
}

// Kiểm tra tính hợp lệ của CCCD: đúng 12 chữ số (hoặc 9 số CMND)
export function isValidCccd(cccd: string): boolean {
  if (!cccd) return false;
  const digits = cccd.replace(/\D/g, '');
  return digits.length === 12 || digits.length === 9;
}

// Kiểm tra tính hợp lệ của năm sinh (4 chữ số, từ 1920 đến năm hiện tại)
export function isValidBirthYear(year: string): boolean {
  if (!year) return false;
  const y = parseInt(year.trim(), 10);
  const currentYear = new Date().getFullYear();
  return !isNaN(y) && /^\d{4}$/.test(year.trim()) && y >= 1920 && y <= currentYear;
}

// Kiểm tra họ và tên hợp lệ (tối thiểu 2 từ, không rỗng)
export function isValidFullName(name: string): boolean {
  if (!name) return false;
  const cleaned = cleanName(name);
  const words = cleaned.split(/\s+/).filter(Boolean);
  return words.length >= 2;
}

/**
 * Kiểm tra chuỗi tên có phải là tên người thật hay không
 * Phân biệt chính xác giữa:
 * - Tên người: Nguyễn Văn A, Y Ber Niê, H' Duyên Liêng, Ông Sơn, Bà Mai, Vàng A Chợ, etc.
 * - Không phải tên người: Chuỗi rỗng, số, dấu chấm, mã geohash (w6jp...),
 *   placeholder (Chưa có tên, không có tên, không có trong SMK, không có dữ liệu, chưa xác định, vô chủ...),
 *   địa danh (Hồ Ea Rớt, suối, đường, đồi, sông, kênh, mương...),
 *   cơ quan/công trình công cộng (UBND, Trường học, Trạm y tế, Nhà văn hóa, Nghĩa trang, Lâm trường, Công ty...)
 */
export function isPersonName(rawName?: string | null): boolean {
  if (!rawName) return false;
  let s = String(rawName).trim();
  if (!s) return false;

  const lower = s.toLowerCase();

  // 1. Mã geohash hoặc mã rác hệ thống
  if (lower.startsWith('w6jp') || /^[a-z0-9]{10,}$/i.test(s)) return false;

  // 2. Các cụm từ placeholder / không có tên / rác dữ liệu
  const placeholderPhrases = [
    'không có trong dữ liệu',
    'khong co trong du lieu',
    'không có dữ liệu',
    'khong co du lieu',
    'không có trong smk',
    'chưa có dữ liệu',
    'chua co du lieu',
    'chưa có tên',
    'chua co ten',
    'không có tên',
    'khong co ten',
    'chưa rõ',
    'chua ro',
    'không rõ',
    'khong ro',
    'vô chủ',
    'vo chu',
    'vắng chủ',
    'vang chu',
    'chưa xác định',
    'chua xac dinh',
    'không xác định',
    'khong xac dinh',
    'không tồn tại',
    'khong ton tai',
    'đã thu hồi',
    'thu hồi',
    'giáp thửa đất',
    'địa điểm',
    'dia diem',
    'vô danh',
    'vo danh',
    'không có',
    'khong co',
    'chưa có',
    'chua co',
  ];
  if (placeholderPhrases.some((p) => lower.includes(p))) return false;

  // 3. Cơ quan, công trình công cộng, doanh nghiệp, tổ chức
  const organizationPhrases = [
    'ubnd',
    'ủy ban',
    'uy ban',
    'hđnd',
    'hdnd',
    'nhà văn hóa',
    'nha van hoa',
    'nhà văn hoá',
    'hội trường',
    'hoi truong',
    'trường học',
    'truong hoc',
    'trường tiểu học',
    'mầm non',
    'mẫu giáo',
    'điểm trường',
    'trạm y tế',
    'tram y te',
    'bệnh viện',
    'nghĩa trang',
    'nghia trang',
    'nghĩa địa',
    'nghia dia',
    'mồ mả',
    'thủy hệ',
    'thuy he',
    'thủy lợi',
    'đập nước',
    'giao thông',
    'đường giao thông',
    'đường đi',
    'hành lang',
    'kiểm lâm',
    'lâm nghiệp',
    'lâm trường',
    'công ty',
    'cty ',
    'rừng phòng hộ',
    'ban quản lý',
    'ban ql',
    'hợp tác xã',
    'thao trường',
    'quân sự',
    'công an',
    'đình làng',
    'nhà thờ',
    'giáo xứ',
    'đất đồi',
    'đất công',
    'đất trống',
    'đất hoang',
    'đầu mối',
  ];
  if (organizationPhrases.some((o) => lower.includes(o))) return false;

  // 4. Địa danh thuần túy (Hồ, suối, sông...) đứng riêng
  if (lower.includes('hồ ea rớt') || lower.includes('ho ea rot')) {
    // Nếu chỉ là Hồ Ea Rớt mà không kèm tên người
    if (
      !lower.includes('ông') &&
      !lower.includes('bà') &&
      !lower.includes('hộ') &&
      !lower.includes('nguyễn') &&
      !lower.includes('lý') &&
      !lower.includes('trần') &&
      !lower.includes('hoàng') &&
      !lower.includes('dường') &&
      !lower.includes('lăng')
    ) {
      return false;
    }
  }

  // Từ địa danh, địa điểm hoặc loại đất đơn thuần
  const locationPureWords = [
    'suối', 'suoi', 'đường', 'duong', 'sông', 'song', 'núi', 'nui',
    'đồi', 'doi', 'kênh', 'kenh', 'mương', 'muong', 'đất', 'dat',
    'hồ', 'ho', 'thôn', 'thon', 'buôn', 'buon', 'địa điểm', 'dia diem',
    'khu vực', 'khu vuc', 'đập', 'dap', 'rừng', 'rung'
  ];
  if (locationPureWords.includes(lower)) {
    return false;
  }

  // Bắt đầu bằng tiền tố địa danh thuần túy
  if (/^(suối|sông|kênh|mương|núi|đập|đồi|đường|khu vực)\s+/i.test(s)) {
    return false;
  }

  // 5. Kiểm tra ký tự chữ: phải có ít nhất 2 chữ cái tiếng Việt/Latin
  const lettersOnly = s.replace(/[^a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/g, '');
  if (lettersOnly.length < 2) return false;

  // 6. Tách danh xưng: Hộ ông, Hộ bà, Ông:, Bà:, Ông, Bà, Hộ...
  const withoutHonorific = s
    .replace(
      /^(hộ\s+ông\s*:?|hộ\s+bà\s*:?|hộ\s+gia\s+đình\s*:?|vợ\s+chồng\s+ông\s*:?|vợ\s+chồng\s+bà\s*:?|hộ\s*:?|ông\s*:?|bà\s*:?)/gi,
      ''
    )
    .trim();

  const lowerWithoutHonorific = withoutHonorific.toLowerCase();
  const genericNonNames = [
    'nam', 'nữ', 'nu', 'cá nhân', 'ca nhan', 'chung', 'vô danh', 'vo danh',
    'chưa', 'chua', 'không', 'khong', 'vô chủ', 'vo chu', 'địa điểm', 'dia diem'
  ];
  if (genericNonNames.includes(lowerWithoutHonorific)) return false;

  const cleanWithoutHonorific = withoutHonorific.replace(/[^a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/g, '');
  // Nếu sau khi bỏ danh xưng mà không còn chữ cái nào (ví dụ "Ông ..", "Ông 0", "Bà -") -> KHÔNG PHẢI TÊN NGƯỜI
  if (cleanWithoutHonorific.length < 2) return false;

  return true;
}

// Chuẩn hóa địa chỉ thôn/buôn
export function normalizeAddress(addr: string): string {
  if (!addr) return 'xã Cư Pui';
  const a = stripAccents(addr);
  if (a.includes('noh prong')) return 'Thôn Noh Prông, xã Cư Pui';
  if (a.includes('cu phiang') || a.includes('cu piang')) return 'Buôn Cư Phiang, xã Cư Pui';
  if (a.includes('ngo')) return 'Buôn Ngô, xã Cư Pui';
  if (a.includes('tlier') || a.includes('tlia')) return 'Buôn Tliêr, xã Cư Pui';
  if (['ba phuong', 'thon 5', 'thon 6', '3 phuong'].some((k) => a.includes(k))) return 'Thôn Ba Phường, xã Cư Pui';
  if (['cam phong', 'thon 1', 'thon 2'].some((k) => a.includes(k))) return 'Thôn Cẩm Phong, xã Cư Pui';
  if (a.includes('ea uol')) return 'Thôn Ea Uôl, xã Cư Pui';
  if (a.includes('ea khiem')) return 'Thôn Ea Khiêm, xã Cư Pui';
  if (a.includes('cu te')) return 'Thôn Cư Tê, xã Cư Pui';
  if (a.includes('cu rang')) return 'Thôn Cư Rang, xã Cư Pui';
  if (a.includes('ea lang')) return 'Thôn Ea Lang, xã Cư Pui';
  if (a.includes('ea bar') || a.includes('ea ba')) return 'Thôn Ea Bar, xã Cư Pui';
  if (a.includes('rot')) return 'Thôn Ea Rớt, xã Cư Pui';
  if (a.includes('dak tuor') || a.includes('dak tua')) return 'Buôn Đắk Tuôr, xã Cư Pui';
  if (a.includes('khanh')) return 'Buôn Khanh, xã Cư Pui';
  if (a.includes('khoa')) return 'Buôn Khóa, xã Cư Pui';
  if (a.includes('bhung')) return 'Buôn Bhung, xã Cư Pui';
  if (a.includes('blak')) return 'Buôn Blăk, xã Cư Pui';
  if (['hoa phong', 'ho phong', 'thon 3', 'thon 4'].some((k) => a.includes(k))) return 'Thôn Hòa Phong, xã Cư Pui';
  return addr.trim() || 'xã Cư Pui';
}

export const CANONICAL_VILLAGES = [
  'Thôn Ba Phường',
  'Buôn Ngô',
  'Buôn Bhung',
  'Buôn Cư Phiang',
  'Buôn Tliêr',
  'Thôn Hòa Phong',
  'Thôn Cẩm Phong',
  'Thôn Noh Prông',
  'Thôn Ea Khiêm',
  'Buôn Đắk Tuôr',
  'Buôn Khanh',
  'Thôn Ea Uôl',
  'Thôn Ea Lang',
  'Thôn Ea Rớt',
  'Thôn Cư Tê',
  'Thôn Cư Rang',
  'Thôn Ea Bar',
  'Buôn Khóa',
  'Buôn Blăk',
  'Thôn Điện Tân',
  'Chưa xác định',
];

export interface VillageColorInfo {
  fill: string;
  stroke: string;
  label: string;
}

export const VILLAGE_COLORS: Record<string, VillageColorInfo> = {
  'Buôn Đắk Tuôr': { fill: '#f59e0b', stroke: '#78350f', label: 'Buôn Đắk Tuôr' }, // Vàng hổ phách
  'Thôn Ea Lang':   { fill: '#ec4899', stroke: '#831843', label: 'Thôn Ea Lang' },   // Hồng sen
  'Buôn Khanh':     { fill: '#8b5cf6', stroke: '#4c1d95', label: 'Buôn Khanh' },     // Tím violet
  'Buôn Ngô':       { fill: '#06b6d4', stroke: '#164e63', label: 'Buôn Ngô' },       // Xanh ngọc cyan
  'Thôn Hòa Phong': { fill: '#eab308', stroke: '#713f12', label: 'Thôn Hòa Phong' }, // Vàng tươi
  'Thôn Cẩm Phong': { fill: '#d946ef', stroke: '#701a75', label: 'Thôn Cẩm Phong' }, // Tím hồng fuchsia
  'Thôn Ea Uôl':    { fill: '#14b8a6', stroke: '#134e4a', label: 'Thôn Ea Uôl' },    // Xanh lục teal
  'Thôn Ba Phường': { fill: '#f43f5e', stroke: '#881337', label: 'Thôn Ba Phường' }, // Đỏ san hô
  'Thôn Ea Rớt':    { fill: '#fb923c', stroke: '#7c2d12', label: 'Thôn Ea Rớt' },    // Cam sáng
  'Buôn Cư Phiang': { fill: '#6366f1', stroke: '#312e81', label: 'Buôn Cư Phiang' }, // Xanh chàm indigo
  'Buôn Tliêr':     { fill: '#a855f7', stroke: '#581c87', label: 'Buôn Tliêr' },     // Tím tử đinh hương
  'Thôn Ea Khiêm':  { fill: '#84cc16', stroke: '#365314', label: 'Thôn Ea Khiêm' },  // Xanh chanh lime
  'Thôn Cư Tê':     { fill: '#0ea5e9', stroke: '#0c4a6e', label: 'Thôn Cư Tê' },     // Xanh da trời sky
  'Thôn Noh Prông': { fill: '#d97706', stroke: '#451a03', label: 'Thôn Noh Prông' }, // Nâu vàng amber đậm
  'Buôn Bhung':     { fill: '#fb7185', stroke: '#881337', label: 'Buôn Bhung' },     // Đỏ hoa hồng
  'Thôn Cư Rang':   { fill: '#c084fc', stroke: '#6b21a8', label: 'Thôn Cư Rang' },   // Tím nhạt
  'Thôn Ea Bar':    { fill: '#f472b6', stroke: '#9d174d', label: 'Thôn Ea Bar' },    // Hồng phấn
  'Buôn Khóa':      { fill: '#2dd4bf', stroke: '#115e59', label: 'Buôn Khóa' },      // Ngọc bích
  'Buôn Blăk':      { fill: '#a3e635', stroke: '#3f6212', label: 'Buôn Blăk' },      // Xanh mạ
  'Thôn Điện Tân':  { fill: '#94a3b8', stroke: '#334155', label: 'Thôn Điện Tân' },  // Xám đá
  'Chưa xác định':  { fill: '#fdba74', stroke: '#9a3412', label: 'Khác / Chưa rõ' }, // Cam đào ấm
};

// Bản đồ ánh xạ tờ bản đồ sang thôn/buôn đại diện khi địa chỉ không ghi rõ thôn
export const SHEET_TO_VILLAGE: Record<string, string> = {
  '1': 'Thôn Ea Uôl', '2': 'Thôn Ea Uôl', '3': 'Buôn Đắk Tuôr', '4': 'Buôn Khanh',
  '5': 'Buôn Khanh', '6': 'Thôn Ea Uôl', '7': 'Buôn Đắk Tuôr', '8': 'Buôn Khanh',
  '9': 'Buôn Khanh', '10': 'Buôn Khanh', '11': 'Thôn Ea Uôl', '12': 'Buôn Đắk Tuôr',
  '13': 'Buôn Đắk Tuôr', '14': 'Buôn Khanh', '15': 'Buôn Khanh', '16': 'Thôn Ea Uôl',
  '17': 'Buôn Đắk Tuôr', '18': 'Buôn Đắk Tuôr', '19': 'Buôn Khanh', '20': 'Buôn Đắk Tuôr',
  '21': 'Buôn Đắk Tuôr', '22': 'Buôn Đắk Tuôr', '23': 'Buôn Đắk Tuôr', '24': 'Buôn Đắk Tuôr',
  '25': 'Buôn Đắk Tuôr', '26': 'Buôn Khanh', '27': 'Buôn Đắk Tuôr', '28': 'Buôn Đắk Tuôr',
  '29': 'Buôn Khanh', '30': 'Buôn Khanh', '31': 'Buôn Khanh', '32': 'Buôn Khanh',
  '33': 'Buôn Khanh', '34': 'Buôn Đắk Tuôr', '35': 'Buôn Đắk Tuôr', '42': 'Thôn Ea Rớt',
  '43': 'Thôn Ea Rớt', '45': 'Thôn Ea Rớt', '46': 'Thôn Ea Rớt', '47': 'Thôn Ea Rớt',
  '50': 'Thôn Ea Rớt', '63': 'Thôn Cư Tê', '68': 'Thôn Cư Tê', '69': 'Thôn Cư Tê',
  '78': 'Thôn Ea Lang', '79': 'Thôn Ea Lang', '81': 'Thôn Ea Bar', '87': 'Buôn Bhung',
  '88': 'Buôn Bhung', '89': 'Thôn Ea Lang', '90': 'Thôn Ea Lang', '91': 'Thôn Ea Bar',
  '92': 'Thôn Ea Bar', '93': 'Thôn Ea Bar', '94': 'Thôn Ea Bar', '98': 'Buôn Ngô',
  '99': 'Buôn Ngô', '100': 'Buôn Đắk Tuôr', '101': 'Buôn Ngô', '102': 'Buôn Đắk Tuôr',
  '103': 'Thôn Cư Tê', '104': 'Thôn Ea Uôl', '105': 'Thôn Ea Lang', '106': 'Thôn Ea Bar',
  '107': 'Buôn Khanh', '137': 'Buôn Bhung', '138': 'Buôn Bhung', '139': 'Buôn Bhung',
  '140': 'Buôn Bhung', '161': 'Buôn Bhung', '162': 'Buôn Bhung', '163': 'Buôn Bhung',
  '164': 'Buôn Bhung', '186': 'Buôn Đắk Tuôr', '242': 'Buôn Tliêr', '243': 'Buôn Tliêr',
  '244': 'Buôn Tliêr', '245': 'Buôn Tliêr', '246': 'Buôn Tliêr', '247': 'Thôn Noh Prông',
  '248': 'Thôn Hòa Phong', '249': 'Buôn Tliêr', '250': 'Buôn Tliêr', '251': 'Buôn Tliêr',
  '252': 'Buôn Tliêr', '253': 'Thôn Hòa Phong', '254': 'Thôn Ea Khiêm', '255': 'Buôn Tliêr',
  '256': 'Buôn Tliêr', '257': 'Buôn Tliêr', '258': 'Buôn Tliêr', '259': 'Thôn Cẩm Phong',
  '260': 'Thôn Ea Khiêm', '261': 'Thôn Ea Khiêm', '262': 'Thôn Noh Prông', '263': 'Thôn Ba Phường',
  '264': 'Thôn Hòa Phong', '265': 'Thôn Hòa Phong', '266': 'Thôn Hòa Phong', '267': 'Thôn Cẩm Phong',
  '268': 'Thôn Cẩm Phong', '269': 'Thôn Cẩm Phong', '270': 'Thôn Hòa Phong', '271': 'Thôn Noh Prông',
  '272': 'Thôn Noh Prông', '273': 'Thôn Ba Phường', '274': 'Buôn Cư Phiang', '275': 'Buôn Cư Phiang',
  '276': 'Thôn Cẩm Phong', '277': 'Thôn Cẩm Phong', '278': 'Thôn Cẩm Phong', '279': 'Thôn Cẩm Phong',
  '280': 'Thôn Cẩm Phong', '281': 'Thôn Hòa Phong', '282': 'Thôn Cẩm Phong', '283': 'Thôn Ba Phường',
  '284': 'Buôn Cư Phiang', '285': 'Buôn Cư Phiang', '286': 'Thôn Cẩm Phong', '287': 'Thôn Cẩm Phong',
  '288': 'Thôn Cẩm Phong', '289': 'Thôn Cẩm Phong', '290': 'Thôn Ba Phường', '291': 'Thôn Ba Phường',
  '292': 'Buôn Ngô', '293': 'Buôn Ngô', '294': 'Thôn Ba Phường', '295': 'Thôn Ba Phường',
  '296': 'Buôn Ngô', '297': 'Buôn Ngô', '298': 'Buôn Ngô', '299': 'Buôn Ngô',
  '300': 'Buôn Tliêr', '301': 'Thôn Ea Khiêm', '302': 'Thôn Noh Prông', '303': 'Thôn Hòa Phong',
  '304': 'Thôn Hòa Phong', '305': 'Thôn Hòa Phong', '306': 'Thôn Ea Khiêm', '307': 'Thôn Noh Prông',
  '308': 'Thôn Hòa Phong', '309': 'Thôn Hòa Phong', '310': 'Thôn Hòa Phong', '311': 'Thôn Hòa Phong',
  '312': 'Thôn Hòa Phong', '313': 'Thôn Hòa Phong', '314': 'Thôn Cẩm Phong', '315': 'Thôn Cẩm Phong',
  '316': 'Thôn Cẩm Phong', '317': 'Thôn Noh Prông', '318': 'Thôn Hòa Phong', '319': 'Thôn Hòa Phong',
  '320': 'Thôn Cẩm Phong', '321': 'Thôn Cẩm Phong', '322': 'Thôn Cẩm Phong', '323': 'Buôn Cư Phiang',
  '325': 'Thôn Cẩm Phong', '326': 'Thôn Cẩm Phong', '327': 'Thôn Ba Phường', '328': 'Thôn Ba Phường',
  '329': 'Thôn Ba Phường', '330': 'Thôn Ba Phường', '331': 'Thôn Hòa Phong', '332': 'Buôn Ngô',
  '333': 'Thôn Hòa Phong', '334': 'Thôn Hòa Phong', '335': 'Buôn Ngô', '336': 'Buôn Ngô',
  '337': 'Buôn Ngô', '339': 'Buôn Ngô', '340': 'Buôn Ngô', '341': 'Buôn Ngô',
  '342': 'Buôn Ngô', '343': 'Buôn Ngô'
};

export function getCanonicalVillage(addr: string, toBanDo?: string): string {
  if (addr) {
    const a = stripAccents(addr);
    if (a.includes('noh prong')) return 'Thôn Noh Prông';
    if (a.includes('cu phiang') || a.includes('cu piang')) return 'Buôn Cư Phiang';
    if (a.includes('ngo')) return 'Buôn Ngô';
    if (a.includes('tlier') || a.includes('tlia')) return 'Buôn Tliêr';
    if (['ba phuong', 'thon 5', 'thon 6', '3 phuong'].some((k) => a.includes(k))) return 'Thôn Ba Phường';
    if (['cam phong', 'thon 1', 'thon 2'].some((k) => a.includes(k))) return 'Thôn Cẩm Phong';
    if (a.includes('ea uol')) return 'Thôn Ea Uôl';
    if (a.includes('ea khiem')) return 'Thôn Ea Khiêm';
    if (a.includes('cu te')) return 'Thôn Cư Tê';
    if (a.includes('cu rang')) return 'Thôn Cư Rang';
    if (a.includes('ea lang')) return 'Thôn Ea Lang';
    if (a.includes('ea bar') || a.includes('ea ba')) return 'Thôn Ea Bar';
    if (a.includes('rot')) return 'Thôn Ea Rớt';
    if (a.includes('dak tuor') || a.includes('dak tua')) return 'Buôn Đắk Tuôr';
    if (a.includes('khanh')) return 'Buôn Khanh';
    if (a.includes('khoa')) return 'Buôn Khóa';
    if (a.includes('bhung')) return 'Buôn Bhung';
    if (a.includes('blak')) return 'Buôn Blăk';
    if (['hoa phong', 'ho phong', 'thon 3', 'thon 4'].some((k) => a.includes(k))) return 'Thôn Hòa Phong';
    if (a.includes('dien tan')) return 'Thôn Điện Tân';
  }

  // Nếu địa chỉ không xác định được nhưng có số tờ bản đồ -> dùng bản đồ tờ
  if (toBanDo) {
    const cleanTo = String(toBanDo).trim().replace(/^0+/, '');
    if (SHEET_TO_VILLAGE[cleanTo]) {
      return SHEET_TO_VILLAGE[cleanTo];
    }
  }

  return 'Chưa xác định';
}

export function getVillageColor(addrOrVillage: string, toBanDo?: string): VillageColorInfo {
  const canonical = addrOrVillage in VILLAGE_COLORS ? addrOrVillage : getCanonicalVillage(addrOrVillage, toBanDo);
  return (
    VILLAGE_COLORS[canonical] || {
      fill: '#fdba74',
      stroke: '#9a3412',
      label: canonical || 'Khác / Chưa rõ',
    }
  );
}

export function cleanDisplayAddress(rawAddr?: string): string {
  if (!rawAddr || !rawAddr.trim()) return 'Xã Cư Pui';
  let addr = rawAddr.trim().replace(/,\s*$/, '');

  if (/^(x[ãa]\s*)?c[uư]\s*pui$/i.test(addr)) return 'Xã Cư Pui';

  addr = addr.replace(/([,\s]+x[ãa]\s*c[uư]\s*pui)+$/i, '');
  addr = addr.replace(/([,\s]+c[uư]\s*pui)+$/i, '');
  addr = addr.replace(/,\s*$/, '').trim();

  if (!addr) return 'Xã Cư Pui';
  return `${addr}, xã Cư Pui`;
}

