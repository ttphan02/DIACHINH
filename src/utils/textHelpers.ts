export function stripAccents(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .trim();
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

// Chuẩn hóa tên (bỏ dấu cách thừa, viết hoa chữ cái đầu)
export function cleanName(name: any): string {
  if (!name) return '';
  return String(name)
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
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

export function getCanonicalVillage(addr: string): string {
  if (!addr) return 'Chưa xác định';
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
  return 'Chưa xác định';
}
