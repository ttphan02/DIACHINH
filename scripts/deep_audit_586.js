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

// Bảng ánh xạ tờ bản đồ sang thôn buôn
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

async function run() {
  console.log('1. Đang tải Declarations, R2 File List và GGS Cache...');
  
  // A. Lấy declarations
  const declRes = await fetchJson('https://diachinh.phantruc0210.workers.dev/api/declarations');
  const declMap = declRes.declarationsMap || {};
  const totalDecls = Object.keys(declMap).length;
  console.log(`- Tổng số đơn kê khai trong hệ thống: ${totalDecls}`);

  // B. Lấy toàn bộ file CCCD trên R2
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

  console.log(`- Tổng số file trong thư mục cccd/ trên R2: ${r2Objects.length}`);

  // Xây dựng chỉ mục R2: Theo CCCD và theo Tên chuẩn hóa
  const r2CccdSet = new Set();
  const r2FilesByName = new Map(); // normName -> [{ cccd, filename }]
  const allR2Filenames = [];

  for (const o of r2Objects) {
    const key = o.Key;
    const fn = key.replace(/^cccd\//, '').replace(/\.pdf$/i, '');
    allR2Filenames.push(fn);
    
    // Tách số CCCD và tên file
    const m = fn.match(/^(\d{9,12})(?:_(.*))?$/);
    if (m) {
      const cccd = m[1];
      r2CccdSet.add(cccd);
      if (m[2]) {
        const normN = stripAccents(stripHonorifics(m[2])).replace(/[^a-z0-9]/g, '');
        if (normN.length >= 3) {
          if (!r2FilesByName.has(normN)) r2FilesByName.set(normN, []);
          r2FilesByName.get(normN).push({ cccd, filename: key });
        }
      }
    } else {
      const m2 = fn.match(/\b\d{9,12}\b/);
      if (m2) r2CccdSet.add(m2[0]);
      const normN = stripAccents(stripHonorifics(fn)).replace(/[^a-z0-9]/g, '');
      if (normN.length >= 3) {
        if (!r2FilesByName.has(normN)) r2FilesByName.set(normN, []);
        r2FilesByName.get(normN).push({ cccd: m2 ? m2[0] : '', filename: key });
      }
    }
  }
  console.log(`- Số CCCD phân biệt trên R2: ${r2CccdSet.size}`);

  // C. Lấy GGS Cache
  const ggsRes = await s3.send(new GetObjectCommand({ Bucket: 'diachinh-storage', Key: 'cache/ggs.json' }));
  const ggsData = JSON.parse(await ggsRes.Body.transformToString());
  const ggsParcels = ggsData.parcels || {};
  const ggsPeople = ggsData.people || {};
  console.log(`- Số thửa đất trên GGS: ${Object.keys(ggsParcels).length}`);
  console.log(`- Số công dân trên GGS: ${Object.keys(ggsPeople).length}`);

  // Xây dựng danh sách thửa đất trên GGS theo Tên chủ hộ + Thôn buôn
  // key: normName -> array of { cccd, to_ban_do, thon_xa, village, chu_ho }
  const ggsPeopleByNameAndVillage = new Map();
  for (const [maThua, p] of Object.entries(ggsParcels)) {
    const rawName = p.chu_ho || '';
    const cleanName = stripHonorifics(rawName);
    const normN = stripAccents(cleanName).replace(/[^a-z0-9]/g, '');
    if (!normN || normN.length < 3) continue;

    const village = getCanonicalVillage(p.thon_xa, p.to_ban_do);
    const cccd = cleanCccd(p.cccd);

    if (!ggsPeopleByNameAndVillage.has(normN)) {
      ggsPeopleByNameAndVillage.set(normN, []);
    }
    ggsPeopleByNameAndVillage.get(normN).push({
      maThua,
      chu_ho: rawName,
      cccd,
      to_ban_do: p.to_ban_do,
      thon_xa: p.thon_xa,
      village,
    });
  }

  // 2. Lọc ra danh sách ~586 - 595 đơn hiện tại đang xem là CHƯA CÓ CCCD TRÊN R2
  const unverifiedDecls = [];
  let alreadyInR2Count = 0;

  for (const [code, decl] of Object.entries(declMap)) {
    const name = String(decl.chu_dat_ten || decl.chu_ho || '').trim();
    if (!name || name === 'Chưa có tên') continue;

    const hasFile = Boolean(decl.cccd_url || decl.file_cccd_pdf || decl.cccd_file);
    const rawCccd = cleanCccd(decl.chu_dat_cccd || decl.cccd_chu_ho || decl.cccd || '');

    // Điều kiện ban đầu của giao diện (hasCccdInR2)
    let inR2Initial = false;
    if (hasFile) inR2Initial = true;
    if (rawCccd && r2CccdSet.has(rawCccd)) inR2Initial = true;
    
    const cleanOwner = stripHonorifics(name);
    const normOwner = stripAccents(cleanOwner).replace(/[^a-z0-9]/g, '');
    if (!inR2Initial && normOwner.length >= 4) {
      if (r2FilesByName.has(normOwner)) inR2Initial = true;
    }

    if (inR2Initial) {
      alreadyInR2Count++;
    } else {
      unverifiedDecls.push({
        code,
        decl,
        name,
        cleanOwner,
        normOwner,
        rawCccd,
        to_ban_do: String(decl.to_ban_do || '').trim(),
        so_thua: String(decl.so_thua || '').trim(),
        thon_xa: decl.thon_xa || decl.dia_chi_thua_dat || '',
        village: getCanonicalVillage(decl.thon_xa || decl.dia_chi_thua_dat, decl.to_ban_do),
      });
    }
  }

  console.log(`\n======================================================`);
  console.log(`SỐ ĐƠN CẦN KIỂM TRA SÂU: ${unverifiedDecls.length} đơn kê khai`);
  console.log(`(Đã loại trừ ${alreadyInR2Count} đơn đã khớp CCCD R2 rõ ràng trước đó)`);
  console.log(`======================================================\n`);

  // 3. TIẾN HÀNH KIỂM TRA SÂU TỪNG ĐƠN
  // Kết quả chia thành các nhóm:
  const foundInR2_byCccd = [];
  const foundInR2_byName = [];
  const foundInGGS_byCccd = [];
  const foundInGGS_byNameAndVillage = [];
  const trulyMissing = [];

  for (const item of unverifiedDecls) {
    const { code, name, cleanOwner, normOwner, rawCccd, to_ban_do, so_thua, village } = item;
    let resolved = false;

    // A. KIỂM TRA TRONG R2 THEO SỐ CCCD
    if (rawCccd && r2CccdSet.has(rawCccd)) {
      foundInR2_byCccd.push({
        ...item,
        foundCccd: rawCccd,
        note: `Số CCCD ${rawCccd} có file trên R2`,
      });
      resolved = true;
      continue;
    }

    // B. KIỂM TRA TRONG R2 THEO TÊN CHỦ ĐẤT
    if (normOwner && normOwner.length >= 3) {
      // 1. Khớp chính xác normName
      let r2Match = r2FilesByName.get(normOwner);
      // 2. Nếu chưa có, quét substring tên trong các file R2
      if (!r2Match || r2Match.length === 0) {
        for (const [nKey, list] of r2FilesByName.entries()) {
          if (nKey.includes(normOwner) || normOwner.includes(nKey)) {
            if (Math.abs(nKey.length - normOwner.length) <= 3) {
              r2Match = list;
              break;
            }
          }
        }
      }

      if (r2Match && r2Match.length > 0) {
        const m = r2Match[0];
        foundInR2_byName.push({
          ...item,
          foundCccd: m.cccd,
          r2File: m.filename,
          note: `Khớp tên trong file R2: ${m.filename} (CCCD: ${m.cccd || 'chưa rõ'})`,
        });
        resolved = true;
        continue;
      }
    }

    // C. KIỂM TRA TRÊN GOOGLE SHEETS THEO SỐ CCCD
    if (rawCccd) {
      let ggsMatchByCccd = null;
      for (const [mThua, p] of Object.entries(ggsParcels)) {
        if (cleanCccd(p.cccd) === rawCccd) {
          ggsMatchByCccd = p;
          break;
        }
      }
      if (ggsMatchByCccd) {
        const inR2 = r2CccdSet.has(rawCccd);
        foundInGGS_byCccd.push({
          ...item,
          foundCccd: rawCccd,
          ggsOwner: ggsMatchByCccd.chu_ho,
          ggsVillage: getCanonicalVillage(ggsMatchByCccd.thon_xa, ggsMatchByCccd.to_ban_do),
          hasFileInR2: inR2,
          note: `Khớp số CCCD trên GGS (Chủ hộ GGS: ${ggsMatchByCccd.chu_ho}, R2: ${inR2 ? 'CÓ FILE' : 'CHƯA CÓ FILE'})`,
        });
        resolved = true;
        continue;
      }
    }

    // D. KIỂM TRA TRÊN GOOGLE SHEETS THEO TÊN + ĐIỀU KIỆN CÙNG THÔN BUÔN
    if (normOwner && normOwner.length >= 3) {
      const candidates = ggsPeopleByNameAndVillage.get(normOwner) || [];
      
      // Lọc các ứng viên CÙNG THÔN BUÔN
      const matchedSameVillage = candidates.filter(cand => {
        if (!cand.cccd) return false;
        // Kiểm tra cùng thôn buôn
        if (village !== 'Chưa xác định' && cand.village !== 'Chưa xác định') {
          return village === cand.village;
        }
        // Hoặc cùng tờ bản đồ
        if (to_ban_do && cand.to_ban_do) {
          return String(to_ban_do).trim() === String(cand.to_ban_do).trim();
        }
        return false;
      });

      if (matchedSameVillage.length > 0) {
        // Chọn ứng viên đầu tiên có CCCD
        const best = matchedSameVillage[0];
        const inR2 = r2CccdSet.has(best.cccd);
        foundInGGS_byNameAndVillage.push({
          ...item,
          foundCccd: best.cccd,
          ggsOwner: best.chu_ho,
          ggsTo: best.to_ban_do,
          ggsVillage: best.village,
          hasFileInR2: inR2,
          note: `Khớp tên + cùng thôn [${best.village}] trên GGS (CCCD: ${best.cccd}, R2: ${inR2 ? 'ĐÃ CÓ FILE' : 'CHƯA CÓ FILE'})`,
        });
        resolved = true;
        continue;
      }
    }

    // E. HOÀN TOÀN KHÔNG TÌM THẤY
    trulyMissing.push(item);
  }

  // 4. TỔNG KẾT BÁO CÁO CHI TIẾT
  console.log('============= KẾT QUẢ KIỂM TRA SÂU TOÀN DIỆN =============\n');
  console.log(`1. Khớp trực tiếp trên R2 theo SỐ CCCD: ${foundInR2_byCccd.length} đơn`);
  console.log(`2. Khớp trực tiếp trên R2 theo TÊN CHỦ ĐẤT: ${foundInR2_byName.length} đơn`);
  console.log(`3. Khớp trên Google Sheet theo SỐ CCCD: ${foundInGGS_byCccd.length} đơn`);
  const ggsCccdHasR2 = foundInGGS_byCccd.filter(x => x.hasFileInR2).length;
  console.log(`   - Trong đó đã có file PDF trên R2: ${ggsCccdHasR2} đơn`);
  console.log(`   - Chưa có file PDF trên R2: ${foundInGGS_byCccd.length - ggsCccdHasR2} đơn`);
  
  console.log(`4. Khớp trên Google Sheet theo TÊN + CÙNG THÔN BUÔN: ${foundInGGS_byNameAndVillage.length} đơn`);
  const ggsNameHasR2 = foundInGGS_byNameAndVillage.filter(x => x.hasFileInR2).length;
  console.log(`   - Trong đó đã có file PDF trên R2: ${ggsNameHasR2} đơn`);
  console.log(`   - Chưa có file PDF trên R2: ${foundInGGS_byNameAndVillage.length - ggsNameHasR2} đơn`);

  console.log(`\n5. THỰC SỰ CHƯA CÓ CCCD Ở CẢ R2 VÀ GOOGLE SHEET: ${trulyMissing.length} đơn\n`);

  // Lưu báo cáo đầy đủ ra file JSON
  const fullReport = {
    totalChecked: unverifiedDecls.length,
    summary: {
      foundInR2_byCccd: foundInR2_byCccd.length,
      foundInR2_byName: foundInR2_byName.length,
      foundInGGS_byCccd: foundInGGS_byCccd.length,
      foundInGGS_byCccd_hasR2File: ggsCccdHasR2,
      foundInGGS_byNameAndVillage: foundInGGS_byNameAndVillage.length,
      foundInGGS_byNameAndVillage_hasR2File: ggsNameHasR2,
      trulyMissing: trulyMissing.length,
    },
    foundInR2_byCccd,
    foundInR2_byName,
    foundInGGS_byCccd,
    foundInGGS_byNameAndVillage,
    trulyMissing: trulyMissing.map(x => ({
      code: x.code,
      name: x.name,
      to_ban_do: x.to_ban_do,
      so_thua: x.so_thua,
      village: x.village,
      thon_xa: x.thon_xa,
    }))
  };

  fs.writeFileSync('scripts/audit_586_report.json', JSON.stringify(fullReport, null, 2), 'utf-8');
  console.log('Đã xuất báo cáo chi tiết vào diachinh-web/scripts/audit_586_report.json');

  // In mẫu các ca tìm được
  console.log('\n--- MẪU 15 CA TÌM THẤY TRÊN GGS THEO TÊN + CÙNG THÔN BUÔN ---');
  foundInGGS_byNameAndVillage.slice(0, 15).forEach((x, i) => {
    console.log(`${i + 1}. Thửa ${x.code} - ${x.name} (Thôn: ${x.village}) -> CCCD: ${x.foundCccd} (PDF R2: ${x.hasFileInR2 ? 'CÓ' : 'CHƯA'}) [Chủ hộ GGS: ${x.ggsOwner}, Tờ ${x.ggsTo}]`);
  });

  console.log('\n--- MẪU 15 CA TÌM THẤY TRÊN R2 THEO TÊN FILE ---');
  foundInR2_byName.slice(0, 15).forEach((x, i) => {
    console.log(`${i + 1}. Thửa ${x.code} - ${x.name} (Thôn: ${x.village}) -> File: ${x.r2File} (CCCD: ${x.foundCccd})`);
  });

  console.log('\n--- MẪU 15 CA THỰC SỰ CHƯA CÓ CCCD Ở CẢ 2 NƠI ---');
  trulyMissing.slice(0, 15).forEach((x, i) => {
    console.log(`${i + 1}. Thửa ${x.code} - ${x.name} (Tờ ${x.to_ban_do}, Thửa ${x.so_thua}, Thôn: ${x.village})`);
  });
}

run().catch(console.error);
