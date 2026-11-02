const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const https = require('https');
const fs = require('fs');

const s3 = new S3Client({
  region: 'auto',
  endpoint: 'https://0c2efc5ecc976a3e83c4d593c0a800d0.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: 'f7f23fdd9f5274a538df6137912bca4a',
    secretAccessKey: 'ba58bd9ac40b2c2fffc245c62f8f4478310f2176afa634c4e0b1053c292b4310',
  }
});

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

function stripAccents(str) {
  if (!str) return '';
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanCccd(val) {
  if (!val) return '';
  const digits = String(val).replace(/\D/g, '');
  if (digits.length === 12 || digits.length === 9) return digits;
  return '';
}

function stripHonorifics(name) {
  if (!name) return '';
  let s = String(name).trim();
  const honorificRegex = /^(hộ\s+gia\s+đình\s+(ông|bà)?|hộ\s+gđ\s+(ông|bà)?|hộ\s+gđ|vợ\s+chồng\s+(ông|bà)?|vợ\s+chồng|hộ\s+(ông|bà)|hộ|ông|bà|ong|ba|ho\s+ong|ho\s+ba|ho|anh|chị|cô|chú|bác)[\s:,\.\-_/]+/i;
  let prev = '';
  while (s !== prev && honorificRegex.test(s)) {
    prev = s;
    s = s.replace(honorificRegex, '').trim();
  }
  s = s.replace(/^(ông|bà|ong|ba|hộ|ho)\s+/i, '').trim();
  return s;
}

const SHEET_TO_VILLAGE = {
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

function getCanonicalVillage(addr, toBanDo) {
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
  if (toBanDo) {
    const cleanTo = String(toBanDo).trim().replace(/^0+/, '');
    if (SHEET_TO_VILLAGE[cleanTo]) {
      return SHEET_TO_VILLAGE[cleanTo];
    }
  }
  return 'Chưa xác định';
}

async function main() {
  console.log('=== KIỂM TRA SÂU TOÀN DIỆN CÁC ĐƠN KÊ KHAI CHƯA CÓ CCCD TRÊN R2 ===');

  // 1. Lấy dữ liệu
  const declRes = await fetchJson('https://diachinh.phantruc0210.workers.dev/api/declarations');
  const declMap = declRes.declarationsMap || {};

  const ggsRes = await s3.send(new GetObjectCommand({ Bucket: 'diachinh-storage', Key: 'cache/ggs.json' }));
  const ggsData = JSON.parse(await ggsRes.Body.transformToString());
  const ggsParcels = ggsData.parcels || {};

  // Lấy R2 objects
  const r2Objects = [];
  let token = undefined;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: 'diachinh-storage',
      Prefix: 'cccd/',
      MaxKeys: 1000,
      ContinuationToken: token,
    }));
    if (res.Contents) r2Objects.push(...res.Contents);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  // Chỉ mục R2
  const r2CccdSet = new Set();
  const r2ExactNameMap = new Map(); // exact normName (full words) -> [{ cccd, filename }]
  for (const o of r2Objects) {
    const fn = o.Key.replace(/^cccd\//, '').replace(/\.pdf$/i, '');
    const m = fn.match(/^(\d{9,12})(?:_(.*))?$/);
    if (m) {
      r2CccdSet.add(m[1]);
      if (m[2]) {
        const normWords = stripAccents(stripHonorifics(m[2])).split(/\s+/).filter(Boolean).join(' ');
        if (normWords.length >= 3) {
          if (!r2ExactNameMap.has(normWords)) r2ExactNameMap.set(normWords, []);
          r2ExactNameMap.get(normWords).push({ cccd: m[1], filename: o.Key });
        }
      }
    } else {
      const m2 = fn.match(/\b\d{9,12}\b/);
      if (m2) r2CccdSet.add(m2[0]);
      const normWords = stripAccents(stripHonorifics(fn)).split(/\s+/).filter(Boolean).join(' ');
      if (normWords.length >= 3) {
        if (!r2ExactNameMap.has(normWords)) r2ExactNameMap.set(normWords, []);
        r2ExactNameMap.get(normWords).push({ cccd: m2 ? m2[0] : '', filename: o.Key });
      }
    }
  }

  // Chỉ mục GGS: theo exact normName (full words)
  const ggsByName = new Map(); // normWords -> array of { cccd, chu_ho, to_ban_do, thon_xa, village, maThua }
  for (const [maThua, p] of Object.entries(ggsParcels)) {
    const rawName = p.chu_ho || '';
    const normWords = stripAccents(stripHonorifics(rawName)).split(/\s+/).filter(Boolean).join(' ');
    if (!normWords || normWords.length < 3) continue;

    const village = getCanonicalVillage(p.thon_xa, p.to_ban_do);
    const cccd = cleanCccd(p.cccd);

    if (!ggsByName.has(normWords)) ggsByName.set(normWords, []);
    ggsByName.get(normWords).push({
      maThua,
      chu_ho: rawName,
      cccd,
      to_ban_do: String(p.to_ban_do || '').trim(),
      thon_xa: p.thon_xa || '',
      village,
    });
  }

  // 2. Phân loại các đơn kê khai
  // Những đơn đã có file PDF trên R2 hoặc số CCCD đã có file trên R2
  const alreadyResolved = [];
  const needAudit = [];

  for (const [code, decl] of Object.entries(declMap)) {
    const name = String(decl.chu_dat_ten || decl.chu_ho || '').trim();
    if (!name || name === 'Chưa có tên') continue;

    const hasFile = Boolean(decl.cccd_url || decl.file_cccd_pdf || decl.cccd_file);
    const rawCccd = cleanCccd(decl.chu_dat_cccd || decl.cccd_chu_ho || decl.cccd || '');
    
    // Nếu đơn có file hoặc CCCD đã có file R2
    if (hasFile || (rawCccd && r2CccdSet.has(rawCccd))) {
      alreadyResolved.push({ code, name, rawCccd });
    } else {
      needAudit.push({
        code,
        decl,
        name,
        cleanName: stripHonorifics(name),
        normWords: stripAccents(stripHonorifics(name)).split(/\s+/).filter(Boolean).join(' '),
        rawCccd,
        to_ban_do: String(decl.to_ban_do || '').trim(),
        so_thua: String(decl.so_thua || '').trim(),
        thon_xa: decl.thon_xa || decl.dia_chi_thua_dat || '',
        village: getCanonicalVillage(decl.thon_xa || decl.dia_chi_thua_dat, decl.to_ban_do),
      });
    }
  }

  console.log(`- Tổng đơn kê khai có tên: ${alreadyResolved.length + needAudit.length}`);
  console.log(`- Đã có CCCD trong R2 rõ ràng: ${alreadyResolved.length}`);
  console.log(`- ĐƠN CẦN KIỂM TRA SÂU: ${needAudit.length} đơn\n`);

  // 3. Thực hiện kiểm tra 4 trường hợp theo yêu cầu người dùng:
  // (1) R2 theo số CCCD (đơn có số CCCD nhưng R2 có file không)
  // (2) R2 theo Tên chủ đất (tên chính xác)
  // (3) GGS theo số CCCD (đơn có số CCCD -> tra trên GGS)
  // (4) GGS theo Tên chủ đất VỚI ĐIỀU KIỆN CÙNG THÔN BUÔN
  // (5) GGS theo Tên nhưng KHÁC THÔN BUÔN (loại trừ theo điều kiện)
  // (6) Hoàn toàn không có ở đâu

  const cat1_R2_byCccd = [];
  const cat2_R2_byName = [];
  const cat3_GGS_byCccd = [];
  const cat4_GGS_byName_sameVillage = [];
  const cat5_GGS_byName_diffVillage = [];
  const cat6_trulyMissing = [];

  for (const item of needAudit) {
    const { code, name, normWords, rawCccd, to_ban_do, village } = item;
    let found = false;

    // 1. R2 theo số CCCD
    if (rawCccd && r2CccdSet.has(rawCccd)) {
      cat1_R2_byCccd.push({
        ...item,
        foundCccd: rawCccd,
        note: `Đơn có số CCCD ${rawCccd} và số này CÓ FILE trong R2`,
      });
      found = true;
      continue;
    }

    // 2. R2 theo tên chính xác
    if (normWords && r2ExactNameMap.has(normWords)) {
      const matches = r2ExactNameMap.get(normWords);
      const m = matches[0];
      cat2_R2_byName.push({
        ...item,
        foundCccd: m.cccd,
        r2File: m.filename,
        note: `Tên "${name}" khớp chính xác file R2: ${m.filename}`,
      });
      found = true;
      continue;
    }

    // 3. GGS theo số CCCD
    if (rawCccd) {
      // Tìm trên GGS xem có ai mang số CCCD này không
      let ggsMatch = null;
      for (const [mThua, p] of Object.entries(ggsParcels)) {
        if (cleanCccd(p.cccd) === rawCccd) {
          ggsMatch = p;
          break;
        }
      }
      if (ggsMatch) {
        const inR2 = r2CccdSet.has(rawCccd);
        cat3_GGS_byCccd.push({
          ...item,
          foundCccd: rawCccd,
          ggsOwner: ggsMatch.chu_ho,
          ggsVillage: getCanonicalVillage(ggsMatch.thon_xa, ggsMatch.to_ban_do),
          hasFileInR2: inR2,
          note: `Đơn có số CCCD ${rawCccd} trùng trên GGS (${ggsMatch.chu_ho}). PDF R2: ${inR2 ? 'CÓ' : 'CHƯA'}`,
        });
        found = true;
        continue;
      }
    }

    // 4. GGS theo Tên + ĐIỀU KIỆN CÙNG THÔN BUÔN
    if (normWords && ggsByName.has(normWords)) {
      const candidates = ggsByName.get(normWords);
      
      // Lọc các bản ghi cùng thôn buôn
      const sameVillageCands = candidates.filter(cand => {
        if (village !== 'Chưa xác định' && cand.village !== 'Chưa xác định') {
          return village === cand.village;
        }
        if (to_ban_do && cand.to_ban_do) {
          return to_ban_do === cand.to_ban_do;
        }
        return false;
      });

      if (sameVillageCands.length > 0) {
        // Lấy ứng viên có CCCD
        const candWithCccd = sameVillageCands.find(c => c.cccd) || sameVillageCands[0];
        const inR2 = candWithCccd.cccd ? r2CccdSet.has(candWithCccd.cccd) : false;
        cat4_GGS_byName_sameVillage.push({
          ...item,
          foundCccd: candWithCccd.cccd || '(Chưa có số CCCD trên GGS)',
          ggsOwner: candWithCccd.chu_ho,
          ggsTo: candWithCccd.to_ban_do,
          ggsVillage: candWithCccd.village,
          hasFileInR2: inR2,
          note: `Tên "${name}" khớp trên GGS tại cùng thôn [${candWithCccd.village}]. CCCD: ${candWithCccd.cccd || 'Trống'}. File R2: ${inR2 ? 'CÓ' : 'CHƯA'}`,
        });
        found = true;
        continue;
      } else {
        // Có người trùng tên trên GGS nhưng KHÁC thôn buôn
        const first = candidates[0];
        cat5_GGS_byName_diffVillage.push({
          ...item,
          declVillage: village,
          ggsOwner: first.chu_ho,
          ggsVillage: first.village,
          ggsTo: first.to_ban_do,
          ggsCccd: first.cccd,
          note: `Trùng tên "${name}" trên GGS nhưng KHÁC THÔN BUÔN: Đơn ở [${village}], GGS ở [${first.village}] (Tờ ${first.to_ban_do})`,
        });
        continue;
      }
    }

    // 6. Hoàn toàn không tìm thấy
    cat6_trulyMissing.push(item);
  }

  console.log('================ BÁO CÁO PHÂN TÍCH CHI TIẾT ================');
  console.log(`Tổng số đơn kiểm tra sâu: ${needAudit.length} đơn`);
  console.log(`\n1. [R2 - Theo số CCCD]: ${cat1_R2_byCccd.length} đơn`);
  console.log(`2. [R2 - Theo Tên chuẩn xác]: ${cat2_R2_byName.length} đơn có file PDF trong R2`);
  cat2_R2_byName.forEach(x => {
    console.log(`   * Thửa ${x.code} - ${x.name} -> File: ${x.r2File} (CCCD: ${x.foundCccd})`);
  });

  console.log(`\n3. [GGS - Theo số CCCD trong đơn]: ${cat3_GGS_byCccd.length} đơn`);
  console.log(`   - Trong đó đã có file trên R2: ${cat3_GGS_byCccd.filter(x => x.hasFileInR2).length} đơn`);
  console.log(`   - Chưa có file PDF trên R2: ${cat3_GGS_byCccd.filter(x => !x.hasFileInR2).length} đơn`);

  console.log(`\n4. [GGS - Theo TÊN + ĐK CÙNG THÔN BUÔN]: ${cat4_GGS_byName_sameVillage.length} đơn`);
  cat4_GGS_byName_sameVillage.forEach(x => {
    console.log(`   * Thửa ${x.code} - ${x.name} (Thôn: ${x.village}, Tờ: ${x.to_ban_do})`);
    console.log(`     -> GGS: ${x.ggsOwner} (Thôn: ${x.ggsVillage}, Tờ: ${x.ggsTo}) | CCCD: ${x.foundCccd} | File R2: ${x.hasFileInR2 ? 'ĐÃ CÓ' : 'CHƯA CÓ'}`);
  });

  console.log(`\n5. [GGS - Trùng Tên nhưng KHÁC THÔN BUÔN (BỊ LOẠI TRỪ)]: ${cat5_GGS_byName_diffVillage.length} đơn`);
  cat5_GGS_byName_diffVillage.slice(0, 10).forEach(x => {
    console.log(`   * Thửa ${x.code} - ${x.name}: Đơn ở [${x.declVillage}] vs GGS ở [${x.ggsVillage}] (Tờ ${x.ggsTo})`);
  });

  console.log(`\n6. [THỰC SỰ KHÔNG CÓ CCCD Ở CẢ R2 VÀ GGS]: ${cat6_trulyMissing.length} đơn`);

  // Phân tích theo thôn buôn cho nhóm thực sự thiếu
  const villageStats = {};
  for (const x of cat6_trulyMissing) {
    const v = x.village || 'Chưa xác định';
    villageStats[v] = (villageStats[v] || 0) + 1;
  }
  console.log('\nThống kê các thửa thực sự thiếu CCCD theo thôn/buôn:');
  Object.entries(villageStats).sort((a,b) => b[1] - a[1]).forEach(([v, count]) => {
    console.log(`   - ${v}: ${count} thửa`);
  });
}

main().catch(console.error);
