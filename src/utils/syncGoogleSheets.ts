import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import parcelsBriefData from '@/data/parcels_brief.json';
import { fetchOrGetCachedGgsData } from '@/utils/ggsData';

// parcelsBrief: ma_thua -> [dien_tich, loai_dat, thon_xa, statusFlag (0: KHONG_TEN, 1: CO_TEN, 2: DA_SO_HOA)]
const parcelsBrief = parcelsBriefData as unknown as Record<string, [string, string, string, number]>;

const R2_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'diachinh-storage';
const R2_PUBLIC_BASE = process.env.NEXT_PUBLIC_CLOUDFLARE_R2_URL || 'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

function getS3Client(): S3Client | null {
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY) {
    return new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY,
        secretAccessKey: R2_SECRET_KEY,
      },
    });
  }
  return null;
}

export * from './textHelpers';
import {
  stripAccents,
  cleanCccd,
  cleanName,
  cleanStrictName,
  normalizeAddress,
  CANONICAL_VILLAGES,
  getCanonicalVillage,
  isValidFullName,
  isValidBirthYear,
  normalizeNguonGoc,
} from './textHelpers';

function parseNameAndType(rawName: string) {
  let name = String(rawName || '').trim();
  let isHo = false;
  if (/^(hộ ông\s*:?|hộ bà\s*:?|hộ\s+)/i.test(name)) {
    isHo = true;
    name = name.replace(/^(hộ ông\s*:?|hộ bà\s*:?|hộ\s+)/i, '').trim();
  } else if (/^(ông\s*:?|bà\s*:?)/i.test(name)) {
    name = name.replace(/^(ông\s*:?|bà\s*:?)/i, '').trim();
  }
  const clean = cleanName(name);
  const subjType = isHo ? 'Hộ gia đình' : 'Cá nhân';
  return { cleanName: clean, subjType };
}

function build57ColRow(
  toMoi: any,
  thuaMoi: any,
  addrRaw: string,
  nameRaw: string,
  dobRaw: string,
  genderRaw: string,
  cccdRaw: string,
  loaiDat: string,
  dtRaw: any,
  originRaw: string,
  attachedFile?: string
): string[] {
  const addrNorm = normalizeAddress(addrRaw);
  const { cleanName: cName, subjType } = parseNameAndType(nameRaw);
  const dob = String(dobRaw || '').trim();
  const gender = String(genderRaw || '').toLowerCase().includes('nam') ? 'Nam' : 'Nữ';
  const cccd = cleanCccd(cccdRaw);
  const area = String(dtRaw || '').trim().replace('.', ',');
  const origin = String(originRaw || '').trim() || 'Khai hoang';
  const maGcn = `CHUACOGIAY_24478_${toMoi}_${thuaMoi}`;
  const fileName = attachedFile || `CHUACOGIAY_24478_${toMoi}_${thuaMoi}_DDK.pdf`;

  const row = new Array(57).fill('');
  row[0] = '24478';
  row[1] = maGcn;
  row[6] = cName;
  row[7] = dob;
  row[8] = gender;
  row[9] = cccd ? `="${cccd}"` : '';
  row[10] = addrNorm;
  row[11] = subjType;
  row[12] = subjType;
  row[20] = String(toMoi);
  row[21] = String(thuaMoi);
  row[22] = addrNorm;
  row[24] = area;
  row[25] = area;
  row[27] = loaiDat || 'DGT';
  row[28] = area;
  row[30] = 'Sử dụng riêng';
  row[31] = 'Lâu dài';
  row[32] = 'Nhà nước công nhận QSDĐ như giao đất không thu tiền sử dụng đất';
  row[33] = origin;
  row[40] = 'Đủ điều kiện cấp GCN';
  row[41] = '0';
  row[42] = 'Không';
  row[51] = fileName;
  const fileUrl = `/api/image/filescan/${encodeURIComponent(fileName)}`;
  row[52] = `=HYPERLINK("${fileUrl}"; "${fileName}")`;
  return row;
}

// Lấy danh sách mã GGS từ bộ nhớ cache hoặc nạp trực tiếp từ Google Sheets CSV
async function getCachedGgsData(): Promise<{
  ggsCodes: Set<string>;
  ggsParcels: Record<string, any>;
  ggsAllCccds: Set<string>;
  ggsPeople: Record<string, any>;
}> {
  const ggsCodes = new Set<string>();
  const ggsAllCccds = new Set<string>();
  let ggsParcels: Record<string, any> = {};
  let ggsPeople: Record<string, any> = {};

  try {
    const data = await fetchOrGetCachedGgsData();
    if (Array.isArray(data.codes)) {
      data.codes.forEach((c: string) => ggsCodes.add(c));
    }
    if (Array.isArray(data.allCccds)) {
      data.allCccds.forEach((c: string) => {
        const clean = cleanCccd(c);
        if (clean) ggsAllCccds.add(clean);
      });
    }
    if (data.parcels) {
      ggsParcels = data.parcels;
    }
    if (data.people) {
      ggsPeople = data.people;
    }
  } catch (e) {
    console.warn('Lỗi lấy GGS cache:', e);
  }

  return { ggsCodes, ggsParcels, ggsAllCccds, ggsPeople };
}

let cachedR2Files: { cccdFiles: Set<string>; scanFiles: Set<string>; timestamp: number } | null = null;

export function invalidateR2Cache(): void {
  cachedR2Files = null;
}

// Lấy toàn bộ danh sách file CCCD và file SCAN trên R2 với phân trang đầy đủ (cache 60s)
async function getR2StorageFiles(r2Bucket?: any): Promise<{ cccdFiles: Set<string>; scanFiles: Set<string> }> {
  const now = Date.now();
  if (cachedR2Files && now - cachedR2Files.timestamp < 60000) {
    return { cccdFiles: cachedR2Files.cccdFiles, scanFiles: cachedR2Files.scanFiles };
  }

  const cccdFiles = new Set<string>();
  const scanFiles = new Set<string>();

  // 1. Thử qua R2 Binding (khi chạy trên Cloudflare Worker / OpenNext)
  if (r2Bucket) {
    try {
      // Đọc toàn bộ prefix cccd/ với phân trang cursor
      let cccdCursor: string | undefined;
      do {
        const cccdRes: any = await r2Bucket.list({ prefix: 'cccd/', cursor: cccdCursor, limit: 1000 });
        for (const obj of cccdRes?.objects || []) {
          const name = obj.key.replace(/^cccd\//, '');
          if (name) cccdFiles.add(name);
        }
        cccdCursor = cccdRes?.truncated ? cccdRes.cursor : undefined;
      } while (cccdCursor);

      // Đọc toàn bộ prefix scanhoso/
      let scanCursor: string | undefined;
      do {
        const scanRes: any = await r2Bucket.list({ prefix: 'scanhoso/', cursor: scanCursor, limit: 1000 });
        for (const obj of scanRes?.objects || []) {
          const name = obj.key.replace(/^scanhoso\//, '');
          if (name) scanFiles.add(name);
        }
        scanCursor = scanRes?.truncated ? scanRes.cursor : undefined;
      } while (scanCursor);

      // Đọc toàn bộ prefix filescan/
      let filescanCursor: string | undefined;
      do {
        const filescanRes: any = await r2Bucket.list({ prefix: 'filescan/', cursor: filescanCursor, limit: 1000 });
        for (const obj of filescanRes?.objects || []) {
          const name = obj.key.replace(/^filescan\//, '');
          if (name) scanFiles.add(name);
        }
        filescanCursor = filescanRes?.truncated ? filescanRes.cursor : undefined;
      } while (filescanCursor);

      cachedR2Files = { cccdFiles, scanFiles, timestamp: now };
      return { cccdFiles, scanFiles };
    } catch (e) {
      console.warn('Lỗi list R2 qua binding, chuyển sang fallback S3 SDK:', e);
    }
  }

  // 2. Fallback qua S3 SDK (khi chạy Node.js hoặc local dev)
  try {
    const s3 = getS3Client();
    if (s3) {
      // List cccd/
      let token: string | undefined;
      do {
        const res = await s3.send(
          new ListObjectsV2Command({
            Bucket: R2_BUCKET,
            Prefix: 'cccd/',
            ContinuationToken: token,
          })
        );
        for (const obj of res.Contents || []) {
          if (obj.Key) {
            const name = obj.Key.replace(/^cccd\//, '');
            if (name) cccdFiles.add(name);
          }
        }
        token = res.NextContinuationToken;
      } while (token);

      // List scanhoso/
      let tokenScan: string | undefined;
      do {
        const res = await s3.send(
          new ListObjectsV2Command({
            Bucket: R2_BUCKET,
            Prefix: 'scanhoso/',
            ContinuationToken: tokenScan,
          })
        );
        for (const obj of res.Contents || []) {
          if (obj.Key) {
            const name = obj.Key.replace(/^scanhoso\//, '');
            if (name) scanFiles.add(name);
          }
        }
        tokenScan = res.NextContinuationToken;
      } while (tokenScan);

      // List filescan/
      let tokenFilescan: string | undefined;
      do {
        const res = await s3.send(
          new ListObjectsV2Command({
            Bucket: R2_BUCKET,
            Prefix: 'filescan/',
            ContinuationToken: tokenFilescan,
          })
        );
        for (const obj of res.Contents || []) {
          if (obj.Key) {
            const name = obj.Key.replace(/^filescan\//, '');
            if (name) scanFiles.add(name);
          }
        }
        tokenFilescan = res.NextContinuationToken;
      } while (tokenFilescan);

      cachedR2Files = { cccdFiles, scanFiles, timestamp: now };
    }
  } catch (e) {
    console.warn('Lỗi list R2 storage files qua S3 SDK:', e);
  }

  return { cccdFiles, scanFiles };
}

// Hàm chính đồng bộ và tính toán thống kê toàn bộ bảng tính
export async function executeSyncToGoogleSheet(
  declarationsMap: Record<string, any>,
  r2Bucket?: any
): Promise<{
  success: boolean;
  message: string;
  summary?: {
    totalDeclared: number;
    daGiaiQuyet: number;
    choNhap?: number;
    nhapDuLieu?: number;
    nhapGgs: number;
    daDongTap: number;
    canTimCccd: number;
    khongCoCccd: number;
    gcnOnt?: number;
  };
  sheetsData?: Record<string, string[][]>;
}> {
  try {
    console.log('>>> Cloudflare Sync: Bắt đầu tối ưu...');

    // 1. Lấy mã GGS và danh sách file CCCD & SCAN từ R2
    // 1. Lấy mã GGS và danh sách file CCCD & SCAN từ R2
    const [{ ggsCodes, ggsParcels, ggsAllCccds, ggsPeople }, { cccdFiles, scanFiles }] = await Promise.all([
      getCachedGgsData(),
      getR2StorageFiles(r2Bucket),
    ]);

    // Lập bản đồ tra cứu tên chủ hộ + Thôn buôn -> CCCD (Cột K / Cột 10 trên GGS)
    // Chỉ khớp khi tên trên GGS và tên đơn kê khai cùng 1 thôn buôn theo đúng yêu cầu nghiệp vụ
    const nameAndVillageToCccd = new Map<string, string>();
    const allGgsCccds = new Set<string>(ggsAllCccds || []);
    const allGgsNamesInVillage = new Set<string>();

    for (const p of Object.values(ggsParcels)) {
      if (p.chu_ho) {
        const nStrict = cleanStrictName(p.chu_ho);
        const pVillage = getCanonicalVillage(p.thon_xa || '', p.to_ban_do);
        if (nStrict && pVillage && pVillage !== 'Chưa xác định') {
          const nvKey = `${nStrict}__${pVillage}`;
          allGgsNamesInVillage.add(nvKey);
          if (p.cccd) {
            const cClean = cleanCccd(p.cccd);
            if (cClean) {
              allGgsCccds.add(cClean);
              if (!nameAndVillageToCccd.has(nvKey)) {
                nameAndVillageToCccd.set(nvKey, cClean);
              }
            }
          }
        }
      }
    }

    if (ggsPeople) {
      for (const [stName, person] of Object.entries(ggsPeople)) {
        if (person.cccd) {
          const cClean = cleanCccd(person.cccd);
          if (cClean) {
            allGgsCccds.add(cClean);
            const pVillage = getCanonicalVillage(person.dia_chi || '', person.to_ban_do);
            if (pVillage && pVillage !== 'Chưa xác định') {
              const nvKey = `${stName}__${pVillage}`;
              if (!nameAndVillageToCccd.has(nvKey)) {
                nameAndVillageToCccd.set(nvKey, cClean);
              }
            }
          }
        }
      }
    }

    // Pre-index Scan Files để tra cứu O(1), triệt tiêu vòng lặp quét 1.000 files gây quá tải CPU (lỗi 1102)
    const scanByToThua = new Map<string, string>();
    const scanByCccd = new Map<string, string>();

    for (const sf of scanFiles) {
      // Chuẩn hóa tên file: loại bỏ tiền tố CHUACOGIAY_24478_ và hậu tố -DDK
      const cleanSf = sf.replace(/^CHUACOGIAY_\d+_/i, '').replace(/[-_]DDK(\.pdf)?$/i, '');
      const mtMatch = cleanSf.match(/(\d+)[_-](\d+)/);
      if (mtMatch) {
        const toNum = String(parseInt(mtMatch[1], 10) || mtMatch[1]);
        const thuaNum = String(parseInt(mtMatch[2], 10) || mtMatch[2]);
        const key = `${toNum}_${thuaNum}`;
        if (!scanByToThua.has(key)) scanByToThua.set(key, sf);
        scanByToThua.set(`${mtMatch[1]}_${mtMatch[2]}`, sf);
      }
      const cMatch = sf.match(/(?:^|\D)(\d{9,12})(?:\D|$)/);
      const cleanC = cMatch ? cleanCccd(cMatch[1]) : cleanCccd(sf);
      if (cleanC && (cleanC.length === 12 || cleanC.length === 9) && !scanByCccd.has(cleanC)) {
        scanByCccd.set(cleanC, sf);
      }
    }

    // Pre-index CCCD Files để tra cứu O(1) theo số, theo mã thửa, và theo TÊN CHÍNH XÁC (STRICT TONE MATCHING)
    const cccdByNumber = new Map<string, string>();
    const cccdByToThua = new Map<string, string>();
    const cccdByStrictName = new Map<string, { filename: string; cccdCandidate?: string }>();

    for (const cf of cccdFiles) {
      const cleanCf = cf.replace(/\.pdf$/i, '');
      const digitsMatch = cleanCf.match(/(?:^|\D)(\d{9,12})(?:\D|$)/);
      const num = digitsMatch ? cleanCccd(digitsMatch[1]) : cleanCccd(cleanCf);
      if (num && (num.length === 12 || num.length === 9) && !cccdByNumber.has(num)) {
        cccdByNumber.set(num, cf);
      }
      const mtMatch = cleanCf.match(/(?:^|\D)(\d+)[_-](\d+)(?:\D|$)/);
      if (mtMatch) {
        const toNum = String(parseInt(mtMatch[1], 10) || mtMatch[1]);
        const thuaNum = String(parseInt(mtMatch[2], 10) || mtMatch[2]);
        const key = `${toNum}_${thuaNum}`;
        if (!cccdByToThua.has(key)) cccdByToThua.set(key, cf);
      }
      // Trích xuất tên công dân từ tên file CCCD (dạng {12_so}_{Ho_Ten}.pdf)
      const namePartMatch = cleanCf.match(/^\d{9,12}_(.*)$/);
      if (namePartMatch) {
        const strictInFile = cleanStrictName(namePartMatch[1]);
        if (strictInFile && !cccdByStrictName.has(strictInFile)) {
          cccdByStrictName.set(strictInFile, {
            filename: cf,
            cccdCandidate: (num && (num.length === 12 || num.length === 9)) ? num : undefined,
          });
        }
      }
    }

    // 2. Phân loại 4 giai đoạn CHỈ TRÊN các phiếu đã kê khai (nhẹ, <1ms)
    const stage4DaGiaiQuyet: any[] = [];
    const stage3ChoNhap: any[] = [];
    const stage2DaDongTap: any[] = [];
    const stageGcnOnt: any[] = []; // Danh sách GCN - ONT (các thửa đất ở ONT chờ bổ sung sau)
    const stage1CanTimCccd: any[] = [];
    const stage1KhongCoCccd: any[] = [];

    const processedParcels = new Set<string>();

    for (const [maThua, decl] of Object.entries(declarationsMap)) {
      if (!maThua || processedParcels.has(maThua)) continue;
      processedParcels.add(maThua);

      const parts = maThua.split('_');
      const toMoi = parts[0] || decl.to_ban_do || '';
      const thuaMoi = parts[1] || decl.so_thua || '';

      const chuHo = cleanName(decl.ho_va_ten_chu_ho || decl.chu_ho || decl.chu_dat_ten || '');
      let cccd = cleanCccd(decl.cccd_chu_ho || decl.cccd || decl.chu_dat_cccd || '');
      let cccdSource = cccd ? 'Kê khai web' : '';

      const chuHoNorm = stripAccents(chuHo);
      const meta = parcelsBrief[maThua];
      const fallbackDt = meta ? meta[0] : '';
      const fallbackLoaiDat = meta ? meta[1] : '';
      const fallbackThon = meta ? meta[2] : '';
      const fallbackOwner = meta ? meta[3] : '';

      const ggsP = ggsParcels[maThua];
      const chuHoStrict = cleanStrictName(chuHo);
      const declVillage = getCanonicalVillage(decl.chu_dat_dia_chi || decl.dia_chi_thua_dat || decl.thon_xa || fallbackThon, toMoi);
      const declNvKey = (chuHoStrict && declVillage && declVillage !== 'Chưa xác định')
        ? `${chuHoStrict}__${declVillage}`
        : '';

      // Chỉ lấy CCCD từ GGS khi cùng 1 thôn buôn theo đúng yêu cầu nghiệp vụ
      if (!cccd && declNvKey && nameAndVillageToCccd.has(declNvKey)) {
        cccd = nameAndVillageToCccd.get(declNvKey)!;
        cccdSource = 'Khớp tên GGS cùng thôn buôn';
      } else if (!cccd && ggsP && ggsP.cccd) {
        cccd = cleanCccd(ggsP.cccd);
        if (cccd) cccdSource = 'Khớp thửa GGS';
      }

      // Tự động bổ sung fallback dữ liệu mặc định/ảo nếu thiếu trường
      const rawChuHo = chuHo || fallbackOwner || 'Chủ sử dụng';
      const cleanOwner = cleanName(rawChuHo) || 'Chủ sử dụng';
      const thonXa = normalizeAddress(
        decl.dia_chi_thua_dat || decl.thon_xa || decl.chu_dat_dia_chi || fallbackThon || 'Thôn 1, xã Cư Pui'
      );
      const dienTich = (fallbackDt && parseFloat(fallbackDt) > 0)
        ? String(fallbackDt)
        : ((decl.dien_tich && parseFloat(decl.dien_tich) > 0 && decl.ma_thua === maThua)
            ? String(decl.dien_tich)
            : ((ggsP && ggsP.dien_tich && parseFloat(ggsP.dien_tich) > 0)
                ? String(ggsP.dien_tich)
                : '1000'));
      const loaiDat = decl.loai_dat || (ggsP && ggsP.loai_dat) || fallbackLoaiDat || 'DGT';
      const rawDob = (decl.chu_dat_nam_sinh || decl.nam_sinh_chu_ho || decl.chu_dat_ngay_sinh || '').trim();
      const dob = isValidBirthYear(rawDob) ? rawDob : '1980';
      const rawGender = (decl.chu_dat_gioi_tinh || decl.gioi_tinh_chu_ho || '').trim();
      const gender = (rawGender && ['nam', 'nữ', 'nu'].includes(rawGender.toLowerCase())) ? rawGender : 'Nam';
      const nguonGoc = normalizeNguonGoc(decl.nguon_goc_su_dung || decl.nguon_goc || 'Khai hoang');

      const item: {
        ma_thua: string;
        to_ban_do: any;
        so_thua: any;
        thon_xa: string;
        chu_ho: string;
        cccd: string;
        cccd_source: string;
        dien_tich: string;
        loai_dat: any;
        dob: any;
        gender: any;
        nguon_goc: "Khai Hoang" | "Thừa Kế" | "Tặng Cho" | "Chuyển Nhượng";
        scan_file: string;
        cccd_file: string;
        nguon_chuyen?: string;
      } = {
        ma_thua: maThua,
        to_ban_do: toMoi,
        so_thua: thuaMoi,
        thon_xa: thonXa,
        chu_ho: cleanOwner,
        cccd,
        cccd_source: cccdSource,
        dien_tich: dienTich,
        loai_dat: loaiDat,
        dob: dob,
        gender: gender,
        nguon_goc: nguonGoc,
        scan_file: '',
        cccd_file: '',
        nguon_chuyen: '',
      };

      // GIAI ĐOẠN 4: ĐÃ LÊN GGS CHÍNH (ĐÃ GIẢI QUYẾT)
      // NGUYÊN TẮC: Thửa có trên Trangtinh1 là 100% ĐÃ GIẢI QUYẾT!
      if (ggsCodes.has(maThua)) {
        if (ggsP) {
          if (ggsP.chu_ho) item.chu_ho = ggsP.chu_ho;
          if (ggsP.cccd) item.cccd = cleanCccd(ggsP.cccd);
        }
        stage4DaGiaiQuyet.push(item);
        continue;
      }

      // GIAI ĐOẠN 3: ĐÃ ĐÓNG TẬP & ĐÃ CÓ FILE SCAN TRONG R2 -> CHUYỂN SANG NHẬP DỮ LIỆU!
      const toNum = String(parseInt(String(toMoi || ''), 10) || toMoi || '');
      const thuaNum = String(parseInt(String(thuaMoi || ''), 10) || thuaMoi || '');
      const toThuaKey = `${toNum}_${thuaNum}`;

      let foundScan = scanByToThua.get(toThuaKey) || scanByToThua.get(maThua) || scanByToThua.get(`${toMoi}_${thuaMoi}`) || '';
      if (!foundScan && cccd) {
        foundScan = scanByCccd.get(cccd) || '';
      }

      if (!foundScan && (decl.file_scan_pdf || decl.anh_ho_so_pdf || decl.scan_file)) {
        foundScan = decl.file_scan_pdf || decl.anh_ho_so_pdf || decl.scan_file;
      }

      if (foundScan) {
        item.scan_file = foundScan;
        // Nếu loại đất là ONT hoặc có ONT: Tự động chuyển qua danh sách "GCN - ONT" để bổ sung sau
        if (/ont/i.test(item.loai_dat || '')) {
          item.nguon_chuyen = 'Từ Nhập dữ liệu (Đã có scan)';
          stageGcnOnt.push(item);
        } else {
          stage3ChoNhap.push(item);
        }
        continue;
      }

      // GIAI ĐOẠN 2: CÓ CCCD TRÊN R2 (Theo người dân, không phụ thuộc mã thửa)
      let foundCccd = '';

      // 1. Tìm theo số CCCD (O(1))
      if (cccd && cccdByNumber.has(cccd)) {
        foundCccd = cccdByNumber.get(cccd)!;
      }

      // 2. Nếu chưa có CCCD hoặc chưa tìm thấy theo số, đối soát CHÍNH XÁC 100% THEO TÊN (KHÔNG DÙNG INCLUDES SUBSTRING)
      if (!foundCccd && chuHoStrict.length >= 2) {
        const matchedCf = cccdByStrictName.get(chuHoStrict);
        if (matchedCf) {
          foundCccd = matchedCf.filename;
          if (matchedCf.cccdCandidate) {
            cccd = matchedCf.cccdCandidate;
            cccdSource = 'Trích từ file CCCD R2';
            item.cccd = cccd;
            item.cccd_source = cccdSource;
          }
        }
      }

      // 3. Fallback tìm theo mã thửa (O(1))
      if (!foundCccd) {
        foundCccd = cccdByToThua.get(toThuaKey) || cccdByToThua.get(maThua) || '';
      }

      // 4. Fallback đọc trực tiếp file CCCD đã liên kết trên phiếu kê khai
      if (!foundCccd && (decl.cccd_file || decl.file_cccd_pdf || decl.cccd_url)) {
        const rawCccdRef = String(decl.cccd_file || decl.file_cccd_pdf || decl.cccd_url || '').trim();
        foundCccd = rawCccdRef.split('/').pop() || rawCccdRef;
      }

      // Nếu đã có file CCCD nhưng chưa có số CCCD, trích xuất từ tên file
      if (foundCccd && (!cccd || cleanCccd(cccd).length < 9)) {
        const extMatch = foundCccd.match(/(?:^|\D)(\d{9,12})(?:\D|$)/);
        const extractedNum = extMatch ? cleanCccd(extMatch[1]) : cleanCccd(foundCccd);
        if (extractedNum && (extractedNum.length === 12 || extractedNum.length === 9)) {
          cccd = extractedNum;
          item.cccd = cccd;
          item.cccd_source = 'Trích từ file CCCD R2';
        }
      }

      // Kiểm tra điều kiện SẴN SÀNG ĐÓNG TẬP: Có file CCCD trên R2 và có số CCCD hợp lệ (12 hoặc 9 số)
      const cleanCVal = cleanCccd(cccd);
      const hasCccdAndFile = Boolean(foundCccd && (cleanCVal.length === 12 || cleanCVal.length === 9));

      if (hasCccdAndFile) {
        item.cccd_file = foundCccd;
        // Nếu loại đất là ONT hoặc có ONT: Tự động chuyển qua danh sách "GCN - ONT" để bổ sung sau
        if (/ont/i.test(item.loai_dat || '')) {
          item.nguon_chuyen = 'Từ Đơn kê khai có CCCD';
          stageGcnOnt.push(item);
        } else {
          stage2DaDongTap.push(item);
        }
        continue;
      }

      // GIAI ĐOẠN 1: ĐANG KÊ KHAI (CHƯA CÓ CCCD HOẶC CHƯA CÓ FILE TRÊN R2)
      // Toàn bộ 170 thửa đã kê khai nhưng chưa đủ điều kiện đóng tập đều được gom vào đây
      const inGgs = Boolean(cccd && allGgsCccds.has(cccd));
      if (inGgs) {
        stage1CanTimCccd.push({
          ...item,
          phan_loai: 'CẦN TÌM CCCD',
          ghi_chu: `Đã có thông tin CCCD trên GGS chính (${cccdSource || 'hồ sơ cũ'}) - Cần tìm file scan/ảnh CCCD tải lên R2`,
        });
      } else {
        stage1KhongCoCccd.push({
          ...item,
          phan_loai: 'KHÔNG CÓ CCCD',
          ghi_chu: 'Chưa có CCCD trên GGS chính lẫn R2 - Cần liên hệ chủ hộ thu thập CCCD mới',
        });
      }
    }

    // 3. Xây dựng cấu trúc các Sheet để gửi lên Webhook
    const sheetsData: Record<string, string[][]> = {};

    // SHEET 4: THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)
    const headersPack = [
      'STT', 'Mã thửa', 'Thôn / Buôn', 'Họ và tên chủ đất',
      'Năm sinh', 'Giới tính', 'Số CCCD', 'Diện tích (m²)', 'Loại đất', 'Nguồn gốc sử dụng',
      'Xem file PDF CCCD (Bấm vào xem)'
    ];
    const rowsPack: string[][] = [headersPack];
    stage2DaDongTap.forEach((it, idx) => {
      const cccdLink = `/api/image/cccd/${encodeURIComponent(it.cccd_file)}`;
      const cccdFormula = `=HYPERLINK("${cccdLink}"; "${it.cccd_file}")`;
      const cccdText = it.cccd ? `="${it.cccd}"` : '';
      rowsPack.push([
        String(idx + 1), it.ma_thua, it.thon_xa,
        cleanName(it.chu_ho), it.dob || '', it.gender || 'Nam', cccdText,
        String(it.dien_tich || ''), it.loai_dat || 'DGT', normalizeNguonGoc(it.nguon_goc || 'Khai Hoang'),
        cccdFormula
      ]);
    });
    sheetsData['THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)'] = rowsPack;

    // SHEET 5: THỬA ĐANG KÊ KHAI(CHƯA CÓ CCCD)
    const headersUnpack = [
      'STT', 'Mã thửa', 'Thôn / Buôn', 'Họ và tên chủ đất',
      'Năm sinh', 'Giới tính', 'Số CCCD', 'Diện tích (m²)', 'Loại đất', 'Nguồn gốc sử dụng'
    ];
    const rowsUnpack: string[][] = [headersUnpack];
    const orderedStage1 = [...stage1CanTimCccd, ...stage1KhongCoCccd];
    orderedStage1.forEach((it, idx) => {
      const cccdText = it.cccd ? `="${it.cccd}"` : '';
      rowsUnpack.push([
        String(idx + 1), it.ma_thua, it.thon_xa,
        cleanName(it.chu_ho), it.dob || '', it.gender || 'Nam', cccdText,
        String(it.dien_tich || ''), it.loai_dat || 'DGT', normalizeNguonGoc(it.nguon_goc || 'Khai Hoang')
      ]);
    });
    sheetsData['THỬA ĐANG KÊ KHAI(CHƯA CÓ CCCD)'] = rowsUnpack;

    // SHEET 2: ĐÃ GIẢI QUYẾT
    const headersDone = [
      'STT', 'Mã thửa', 'Thôn / Buôn', 'Họ và tên chủ đất',
      'Năm sinh', 'Giới tính', 'Số CCCD', 'Diện tích (m²)', 'Loại đất', 'Nguồn gốc sử dụng'
    ];
    const rowsDone: string[][] = [headersDone];
    stage4DaGiaiQuyet.forEach((it, idx) => {
      const cccdText = it.cccd ? `="${it.cccd}"` : '';
      rowsDone.push([
        String(idx + 1), it.ma_thua, it.thon_xa,
        cleanName(it.chu_ho), it.dob || '', it.gender || 'Nam', cccdText,
        String(it.dien_tich || ''), it.loai_dat || 'DGT', normalizeNguonGoc(it.nguon_goc || 'Khai Hoang')
      ]);
    });
    sheetsData['ĐÃ GIẢI QUYẾT'] = rowsDone;

    // SHEET 3: NHẬP DỮ LIỆU (Đơn kê khai đã đóng tập và có file scan trong R2 filescan/)
    const headersNhapDuLieu = [
      'STT', 'Mã thửa', 'Tờ BĐ', 'Số thửa', 'Thôn / Buôn', 'Họ và tên chủ đất',
      'Năm sinh', 'Giới tính', 'Số CCCD', 'Diện tích (m²)', 'Loại đất', 'Nguồn gốc sử dụng',
      'Xem & Tải file scan'
    ];
    const rowsNhapDuLieu: string[][] = [headersNhapDuLieu];
    stage3ChoNhap.forEach((it, idx) => {
      const cleanFileName = String(it.scan_file || '').replace(/^filescan\//, '').replace(/^scanhoso\//, '');
      const scanLink = `/api/image/filescan/${encodeURIComponent(cleanFileName)}`;
      const scanFormula = `=HYPERLINK("${scanLink}"; "${cleanFileName}")`;
      const cccdText = it.cccd ? `="${it.cccd}"` : '';
      rowsNhapDuLieu.push([
        String(idx + 1), it.ma_thua, String(it.to_ban_do || ''), String(it.so_thua || ''), it.thon_xa,
        cleanName(it.chu_ho), it.dob || '', it.gender || 'Nam', cccdText,
        String(it.dien_tich || ''), it.loai_dat || 'DGT', normalizeNguonGoc(it.nguon_goc || 'Khai Hoang'),
        scanFormula
      ]);
    });
    sheetsData['NHẬP DỮ LIỆU'] = rowsNhapDuLieu;
    sheetsData['CHỜ NHẬP'] = rowsNhapDuLieu;
    sheetsData['NHẬP GGS'] = rowsNhapDuLieu; // Hỗ trợ tương thích ngược

    // SHEET MỚI: GCN - ONT (Toàn bộ các thửa đất có loại đất ONT từ Nhập dữ liệu và từ Đóng tập có CCCD chuyển sang)
    const headersGcnOnt = [
      'STT', 'Mã thửa', 'Tờ BĐ', 'Số thửa', 'Thôn / Buôn', 'Họ và tên chủ đất',
      'Năm sinh', 'Giới tính', 'Số CCCD', 'Diện tích (m²)', 'Loại đất', 'Nguồn gốc sử dụng',
      'Nguồn chuyển', 'File scan / CCCD'
    ];
    const rowsGcnOnt: string[][] = [headersGcnOnt];
    stageGcnOnt.forEach((it, idx) => {
      const cccdText = it.cccd ? `="${it.cccd}"` : '';
      const fileRef = it.scan_file || it.cccd_file || '';
      let link = '';
      if (it.scan_file) {
        const cleanFn = String(it.scan_file).replace(/^filescan\//, '').replace(/^scanhoso\//, '');
        link = `/api/image/filescan/${encodeURIComponent(cleanFn)}`;
      } else if (it.cccd_file) {
        link = `/api/image/cccd/${encodeURIComponent(it.cccd_file)}`;
      }
      const formula = fileRef ? (link ? `=HYPERLINK("${link}"; "${fileRef}")` : fileRef) : 'Chưa có file';
      rowsGcnOnt.push([
        String(idx + 1), it.ma_thua, String(it.to_ban_do || ''), String(it.so_thua || ''), it.thon_xa,
        cleanName(it.chu_ho), it.dob || '', it.gender || 'Nam', cccdText,
        String(it.dien_tich || ''), it.loai_dat || 'ONT', normalizeNguonGoc(it.nguon_goc || 'Khai Hoang'),
        it.nguon_chuyen || 'GCN - ONT (Bổ sung sau)',
        formula
      ]);
    });
    sheetsData['GCN - ONT'] = rowsGcnOnt;

    // SHEET 1: THỐNG KÊ (Bảng chỉ số tổng quan & Bảng 16 thôn buôn)
    const totalDeclared = processedParcels.size;
    const rowsTk: string[][] = [
      ['BÁO CÁO THỐNG KÊ TIẾN ĐỘ THỦ CÔNG & REALTIME ĐỊA CHÍNH XÃ CƯ PUI'],
      ['Hệ thống tự động đồng bộ trực tiếp từ Cloudflare R2 & Google Sheets Cloud'],
      [],
      ['CHỈ SỐ TIẾN ĐỘ TỔNG THỂ', '', 'SỐ LƯỢNG', 'TỶ LỆ % / GHI CHÚ'],
      ['TỔNG SỐ PHIẾU KÊ KHAI ĐÃ NỘP TRÊN HỆ THỐNG', '', String(totalDeclared), '100%'],
      ['  • GIAI ĐOẠN 4: ĐÃ SỐ HÓA (ĐÃ LÊN GGS CHÍNH)', '', String(stage4DaGiaiQuyet.length), `${((stage4DaGiaiQuyet.length / (totalDeclared || 1)) * 100).toFixed(1)}%`],
      ['  • GIAI ĐOẠN 3: NHẬP DỮ LIỆU (ĐÃ ĐÓNG TẬP & ĐÃ CÓ SCAN R2)', '', String(stage3ChoNhap.length), `${((stage3ChoNhap.length / (totalDeclared || 1)) * 100).toFixed(1)}%`],
      ['  • GIAI ĐOẠN 2: SẴN SÀNG ĐÓNG TẬP (ĐÃ CÓ FILE PDF CCCD R2)', '', String(stage2DaDongTap.length), `${((stage2DaDongTap.length / (totalDeclared || 1)) * 100).toFixed(1)}%`],
      ['  • GIAI ĐOẠN 1: ĐANG KÊ KHAI (ĐANG THIẾU FILE CCCD R2)', '', String(orderedStage1.length), `${((orderedStage1.length / (totalDeclared || 1)) * 100).toFixed(1)}%`],
      ['      - Nhóm 1: CẦN TÌM CCCD (Có trên GGS nhưng thiếu PDF)', '', String(stage1CanTimCccd.length), `${stage1CanTimCccd.length} hồ sơ`],
      ['      - Nhóm 2: KHÔNG CÓ CCCD (Chưa có trên GGS lẫn R2)', '', String(stage1KhongCoCccd.length), `${stage1KhongCoCccd.length} hồ sơ`],
      [],
      [],
      [],
      [],
      [],
      [],
      ['BẢNG THỐNG KÊ TIẾN ĐỘ THỬA ĐẤT CHƯA HOÀN THÀNH THEO 16 THÔN / BUÔN'],
      [
        'STT', 'Tên thôn / buôn', 
        'Chưa thực hiện (Tổng)', 'Chưa thực hiện (Có tên)', 'Chưa thực hiện (Không tên)',
        'Đã kê khai (Tổng)', 'Có CCCD', 'Cần tìm CCCD', 'Không có CCCD',
        'Đã hoàn thành'
      ]
    ];

    const vMap: Record<
      string,
      {
        name: string;
        coTen: number;
        khongTen: number;
        coCccd: number;
        canTim: number;
        khongCccd: number;
        hoanThanh: number;
      }
    > = {};

    CANONICAL_VILLAGES.forEach((v) => {
      vMap[v] = {
        name: v,
        coTen: 0,
        khongTen: 0,
        coCccd: 0,
        canTim: 0,
        khongCccd: 0,
        hoanThanh: 0,
      };
    });

    // Memoize kết quả getCanonicalVillage để không chạy lại regex/stripAccents 11.280 lần
    const villageCache = new Map<string, string>();
    const getVillageCached = (thon: string) => {
      let v = villageCache.get(thon);
      if (!v) {
        v = getCanonicalVillage(thon);
        villageCache.set(thon, v);
      }
      return v;
    };

    // 1. Phân loại các hồ sơ đã kê khai nhưng CHƯA có trên GGS (stage 2, 1a, 1b)
    stage2DaDongTap.forEach((it) => {
      const v = getVillageCached(it.thon_xa);
      if (vMap[v]) vMap[v].coCccd++;
      else vMap['Chưa xác định'].coCccd++;
    });

    stage1CanTimCccd.forEach((it) => {
      const v = getVillageCached(it.thon_xa);
      if (vMap[v]) vMap[v].canTim++;
      else vMap['Chưa xác định'].canTim++;
    });

    stage1KhongCoCccd.forEach((it) => {
      const v = getVillageCached(it.thon_xa);
      if (vMap[v]) vMap[v].khongCccd++;
      else vMap['Chưa xác định'].khongCccd++;
    });

    // 2. Thống kê toàn bộ các thửa đất trong cơ sở dữ liệu xã Cư Pui (11.280 thửa) từ dữ liệu rút gọn siêu nhẹ (O(1) cached)
    for (const [maThua, item] of Object.entries(parcelsBrief)) {
      const thonXa = item[2] || '';
      const statusFlag = item[3]; // 0: KHONG_TEN, 1: CO_TEN_CHUA_SO_HOA_VANG, 2: DA_SO_HOA_XANH
      const v = getVillageCached(thonXa);
      const row = vMap[v] || vMap['Chưa xác định'];

      const isOnGgs = ggsCodes.has(maThua);
      if (isOnGgs || statusFlag === 2) {
        row.hoanThanh++;
      } else if (processedParcels.has(maThua)) {
        // Đã được đếm ở nhóm kê khai (stage 2 / 1a / 1b) ở trên!
      } else if (statusFlag === 1) {
        row.coTen++;
      } else {
        row.khongTen++;
      }
    }

    let sumChuaThucHienTot = 0, sumChuaThucHienCoTen = 0, sumChuaThucHienKhongTen = 0;
    let sumKeKhaiTot = 0, sumCoCccd = 0, sumCanTimCccd = 0, sumKhongCoCccd = 0, sumHoanThanh = 0;

    CANONICAL_VILLAGES.forEach((vName, idx) => {
      const row = vMap[vName];
      const nChuaThucHienTot = row.coTen + row.khongTen;
      const nKeKhai = row.coCccd + row.canTim + row.khongCccd;

      rowsTk.push([
        String(idx + 1),
        vName,
        String(nChuaThucHienTot),
        String(row.coTen),
        String(row.khongTen),
        String(nKeKhai),
        String(row.coCccd),
        String(row.canTim),
        String(row.khongCccd),
        String(row.hoanThanh),
      ]);

      sumChuaThucHienTot += nChuaThucHienTot;
      sumChuaThucHienCoTen += row.coTen;
      sumChuaThucHienKhongTen += row.khongTen;
      sumKeKhaiTot += nKeKhai;
      sumCoCccd += row.coCccd;
      sumCanTimCccd += row.canTim;
      sumKhongCoCccd += row.khongCccd;
      sumHoanThanh += row.hoanThanh;
    });

    rowsTk.push([
      'TỔNG',
      'TOÀN XÃ CƯ PUI',
      String(sumChuaThucHienTot),
      String(sumChuaThucHienCoTen),
      String(sumChuaThucHienKhongTen),
      String(sumKeKhaiTot),
      String(sumCoCccd),
      String(sumCanTimCccd),
      String(sumKhongCoCccd),
      String(sumHoanThanh),
    ]);

    function padRectangular(rows: string[][]): string[][] {
      if (!rows || rows.length === 0) return [];
      const maxLen = Math.max(...rows.map((r) => r.length));
      return rows.map((r) => (r.length < maxLen ? [...r, ...new Array(maxLen - r.length).fill('')] : r));
    }

    sheetsData['THỐNG KÊ'] = padRectangular(rowsTk);
    sheetsData['ĐÃ GIẢI QUYẾT'] = padRectangular(rowsDone);
    sheetsData['NHẬP DỮ LIỆU'] = padRectangular(rowsNhapDuLieu);
    sheetsData['CHỜ NHẬP'] = padRectangular(rowsNhapDuLieu);
    sheetsData['NHẬP GGS'] = padRectangular(rowsNhapDuLieu);
    sheetsData['THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)'] = padRectangular(rowsPack);
    sheetsData['THỬA ĐANG KÊ KHAI(CHƯA CÓ CCCD)'] = padRectangular(rowsUnpack);
    sheetsData['GCN - ONT'] = padRectangular(rowsGcnOnt);

    // 4. Trả về cấu trúc dữ liệu nội bộ (Hoàn toàn đóng gói trên Web / R2, không gửi Webhook ra ngoài)
    console.log('>>> Thống kê & Phân loại nội bộ hoàn tất 100% trong Web/R2');

    return {
      success: true,
      message: `Đã phân loại thành công ${totalDeclared} thửa đất`,
      summary: {
        totalDeclared,
        daGiaiQuyet: stage4DaGiaiQuyet.length,
        nhapDuLieu: stage3ChoNhap.length,
        choNhap: stage3ChoNhap.length,
        nhapGgs: stage3ChoNhap.length,
        daDongTap: stage2DaDongTap.length,
        canTimCccd: stage1CanTimCccd.length,
        khongCoCccd: stage1KhongCoCccd.length,
        gcnOnt: stageGcnOnt.length,
      },
      sheetsData,
    };
  } catch (error: any) {
    console.error('Lỗi khi thực hiện phân loại thống kê nội bộ:', error);
    return { success: false, message: error.message || 'Lỗi xử lý' };
  }
}
