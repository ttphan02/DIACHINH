const fs = require('fs');
const path = require('path');

const DIR_SCAN = 'C:/Users/phant/Downloads/la scan 4.11 đã ký/la scan 4.11 đã ký';

async function lookupGeohash(to, thua) {
  try {
    const url = `https://www.kh2959bmt.net/api/parcels/search?ma_xa=24478&so_to=${encodeURIComponent(to)}&so_thua=${encodeURIComponent(thua)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://www.kh2959bmt.net/nhom-4',
      },
    });
    if (res.ok) {
      const data = await res.json();
      const feat = data?.features?.[0];
      return {
        maDinhDanh: feat?.properties?.ma_thua_dat || '',
        dienTich: feat?.properties?.dien_tich ? String(feat.properties.dien_tich) : null,
        loaiDat: feat?.properties?.muc_dich_su_dung || null,
      };
    }
  } catch (err) {
    console.warn(`Lỗi lookup geohash ${to}_${thua}:`, err.message);
  }
  return { maDinhDanh: '', dienTich: null, loaiDat: null };
}

async function checkTrungThua(to, thua) {
  try {
    const url = `https://www.kh2959bmt.net/api/nhom4/kiem-tra-trung-thua?ma_xa=24478&so_to=${encodeURIComponent(to)}&so_thua=${encodeURIComponent(thua)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://www.kh2959bmt.net/nhom-4',
      },
    });
    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch {}
  return { ton_tai: false, trung: false };
}

async function submitParcel(item) {
  const { to, thua, maThua, chuHo, namSinh, gioiTinh, cccd, thonXa, dienTich, loaiDat, nguonGoc, scanFile } = item;

  // 1. Kiểm tra xem đã nộp chưa
  const status = await checkTrungThua(to, thua);
  if (status.trung) {
    return { ok: true, alreadyExists: true, message: 'Đã lưu trên KH2959 từ trước' };
  }

  // 2. Tra cứu geohash
  const geo = await lookupGeohash(to, thua);
  const finalDt = geo.dienTich || dienTich || '1000';
  const finalLd = geo.loaiDat || loaiDat || 'LUK';

  // 3. Đọc file scan
  const localPath = path.join(DIR_SCAN, scanFile);
  let pdfBytes = null;
  if (fs.existsSync(localPath)) {
    pdfBytes = fs.readFileSync(localPath);
  } else {
    // Thử tìm theo mã tờ thửa
    const altName = `CHUACOGIAY_24478_${to}_${thua}-DDK.pdf`;
    const altPath = path.join(DIR_SCAN, altName);
    if (fs.existsSync(altPath)) {
      pdfBytes = fs.readFileSync(altPath);
    } else {
      // Fallback tải từ R2
      const r2Url = `https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/filescan/${encodeURIComponent(altName)}`;
      const r2Res = await fetch(r2Url);
      if (r2Res.ok) {
        pdfBytes = Buffer.from(await r2Res.arrayBuffer());
      }
    }
  }

  if (!pdfBytes) {
    return { ok: false, error: 'Không tìm thấy file PDF scan' };
  }

  // 4. Chuẩn hóa địa chỉ & nguồn gốc
  const isCuPui = (addr) => {
    if (!addr) return false;
    const s = addr.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd');
    if (s.includes('cu pui')) return true;
    const kws = ['ba phuong', 'buon ngo', 'ngo', 'bhung', 'cu phiang', 'cu piang', 'tlier', 'tlia', 'hoa phong', 'ho phong', 'cam phong', 'noh prong', 'ea khiem', 'dak tuor', 'dak tua', 'buon khanh', 'khanh', 'ea uol', 'ea lang', 'ea rot', 'cu te', 'ea bar', 'ea ba', 'buon khoa', 'khoa', 'buon blak', 'blak', 'dien tan', 'cu rang'];
    return kws.some(k => s.includes(k));
  };
  const diaChiThuongTru = !isCuPui(thonXa)
    ? (thonXa || 'xã Cư Pui')
    : (thonXa.includes('xã Cư Pui') ? thonXa : `${thonXa}, xã Cư Pui`);
  const diaChiThuaDat = thonXa.includes('tỉnh Đắk Lắk') ? thonXa : `${thonXa}, tỉnh Đắk Lắk`;
  const isOnt = /ONT/i.test(finalLd);
  const nguonGocChuan = !isOnt
    ? 'Nhà nước công nhận quyền sử dụng đất như Nhà nước giao đất không thu tiền sử dụng đất'
    : (nguonGoc || 'Khai hoang');

  // 5. Build payload
  const payloadObj = {
    ma_xa: '24478',
    ten_xa: 'Xã Cư Pui',
    doi_tuong: 'Hộ gia đình, cá nhân',
    che_do: 'Chưa được cấp GCN',
    gcn: { so_phat_hanh: '', ngay_cap: '', so_vao_so: '' },
    nguoi_su_dung_hien_tai: { ho_ten: '', cccd: '', dia_chi_thuong_tru: '', ly_do_thay_doi: '' },
    owners: [
      {
        ho_ten: chuHo,
        ngay_sinh: String(namSinh || '1980').match(/\d{4}/)?.[0] || '1980',
        gioi_tinh: String(gioiTinh || 'Nam').toLowerCase().includes('nữ') ? 'Nữ' : 'Nam',
        cccd: cccd,
        dia_chi_thuong_tru: diaChiThuongTru,
        phap_nhan: 'Cá nhân',
        vai_tro_phap_nhan: 'Cá nhân',
      },
    ],
    to_chuc: {
      ten_to_chuc: '',
      ma_dinh_danh_to_chuc: '',
      ho_ten_dai_dien: '',
      ngay_sinh_dai_dien: '',
      gioi_tinh_dai_dien: '',
      ma_dinh_danh_ca_nhan_dai_dien: '',
      dia_chi_thuong_tru_dai_dien: '',
    },
    dung_chung_ho_so_quet: false,
    thua_list: [
      {
        thua: {
          so_to: to,
          so_thua: thua,
          so_to_gcn: '',
          so_thua_gcn: '',
          ma_dinh_danh: geo.maDinhDanh,
          dien_tich_thua_dat: finalDt,
          dia_chi_thua_dat: diaChiThuaDat,
          ghi_chu: '',
        },
        dat1: {
          loai_dat: finalLd,
          dien_tich: finalDt,
          nguon_goc_su_dung: nguonGocChuan,
          hinh_thuc_su_dung: 'Sử dụng riêng',
          thoi_han_su_dung: '50 năm',
        },
        dat2: null,
      },
    ],
  };

  const formData = new FormData();
  formData.append('payload', JSON.stringify(payloadObj));
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  formData.append('file_chinh_0', blob, scanFile);

  const res = await fetch('https://www.kh2959bmt.net/api/nhom4/ho-so', {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Origin': 'https://www.kh2959bmt.net',
      'Referer': 'https://www.kh2959bmt.net/nhom-4',
    },
    body: formData,
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (res.ok && json?.ok) {
    return { ok: true, message: json.message };
  } else if (res.status === 409) {
    return { ok: true, alreadyExists: true, message: json.error || 'Đã tồn tại' };
  } else {
    return { ok: false, error: json.error || json.message || `HTTP ${res.status}` };
  }
}

async function runBatch() {
  const res = await fetch('https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/cache/sync_sheets.json?t=' + Date.now());
  const json = await res.json();
  const nhapRows = json.sheetsData['NHẬP DỮ LIỆU'].slice(1);
  const parcels = JSON.parse(fs.readFileSync('public/data/parcels.json', 'utf8'));
  const pMap = new Map(parcels.map(p => [p.ma_thua, p]));

  const list = [];
  for (const r of nhapRows) {
    const maThua = String(r[1] || '').trim();
    const to = String(r[2] || '').trim();
    const thua = String(r[3] || '').trim();
    const thonXa = String(r[4] || '').trim();
    let chuHo = String(r[5] || '').trim();
    const namSinh = String(r[6] || '1980').trim();
    const gioiTinh = String(r[7] || 'Nam').trim();
    let cccd = String(r[8] || '').replace(/[^0-9]/g, '').trim();

    if (!cccd && pMap.has(maThua)) {
      cccd = String(pMap.get(maThua).cccd || '').replace(/[^0-9]/g, '').trim();
    }
    // Nếu tên chứa số CCCD thì lấy tên từ parcels.json
    if (/^\d+$/.test(chuHo) && pMap.has(maThua)) {
      chuHo = pMap.get(maThua).chu_ho;
    }

    const dienTich = String(r[9] || '1000').replace(',', '.').trim();
    const loaiDat = String(r[10] || 'LUK').trim();
    const nguonGoc = String(r[11] || '').trim();

    let scanFile = '';
    const scanCell = String(r[12] || '');
    const m = scanCell.match(/CHUACOGIAY_[^"';,)]+\.pdf/i) || scanCell.match(/[^"';,)\\]+\.pdf/i);
    if (m) {
      scanFile = m[0];
    } else {
      scanFile = `CHUACOGIAY_24478_${to}_${thua}-DDK.pdf`;
    }

    list.push({ maThua, to, thua, thonXa, chuHo, namSinh, gioiTinh, cccd, dienTich, loaiDat, nguonGoc, scanFile });
  }

  console.log(`Bắt đầu nộp ${list.length} thửa lên KH2959...`);

  let success = 0;
  let failed = 0;
  const results = [];

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    process.stdout.write(`[${i + 1}/${list.length}] Nộp thửa ${item.to}_${item.thua} (${item.chuHo} - ${item.cccd})... `);
    
    try {
      const res = await submitParcel(item);
      if (res.ok) {
        success++;
        console.log(`✓ THÀNH CÔNG (${res.alreadyExists ? 'Đã có' : 'Mới nộp'})`);
      } else {
        failed++;
        console.log(`✗ THẤT BẠI: ${res.error}`);
      }
      results.push({ maThua: item.maThua, ...res });
    } catch (err) {
      failed++;
      console.log(`✗ LỖI MẠNG: ${err.message}`);
      results.push({ maThua: item.maThua, ok: false, error: err.message });
    }

    // Delay 300ms
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n========================================`);
  console.log(`HOÀN TẤT: Thành công: ${success}/${list.length} | Thất bại: ${failed}/${list.length}`);
  console.log(`========================================`);

  fs.writeFileSync('scripts/kh2959_batch_submit_result.json', JSON.stringify(results, null, 2), 'utf8');
}

runBatch().catch(console.error);
