const https = require('https');
const fs = require('fs');

const url = 'https://docs.google.com/spreadsheets/d/1c2xAknmc1fx-xKBJhLp-EcmZwAAnDIgCPf-pj6wmCHc/export?format=csv&gid=0';

https.get(url, (res) => {
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    https.get(res.headers.location, handleRes);
  } else {
    handleRes(res);
  }
});

function parseCSVLine(line) {
  let values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  values.push(current);
  return values;
}

function handleRes(res) {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const lines = data.split(/\r?\n/);
    console.log('Total sheet lines:', lines.length);
    
    // 1. Quét các thửa thuộc Cột A [7916..9250]
    const hiddenByColA = new Set();
    const ggsParcelsMap = {};
    const ggsCodesSet = new Set();
    
    for (let r = 1; r < lines.length; r++) {
      const line = lines[r];
      if (!line.trim()) continue;
      const row = parseCSVLine(line);
      const colA = parseInt(row[0]?.trim(), 10);
      const colBF = row[57]?.trim(); // Cột BF
      const colC = row[2]?.trim();   // Cột C (CHUACOGIAY_24478_to_thua)
      
      let maThua = '';
      if (colBF && colBF.includes('_') && /^\d+_\d+$/.test(colBF)) {
        maThua = colBF;
      } else if (colC) {
        const m = colC.match(/(\d+)_(\d+)$/);
        if (m) maThua = m[1] + '_' + m[2];
      }
      
      if (!isNaN(colA) && colA >= 7916 && colA <= 9250) {
        if (maThua) hiddenByColA.add(maThua);
      } else {
        if (maThua) {
          ggsCodesSet.add(maThua);
          ggsParcelsMap[maThua] = {
            chu_ho: row[7]?.trim() || '',
            cccd: row[10]?.trim() || '',
            to_ban_do: row[20]?.trim() || maThua.split('_')[0],
            so_thua: row[21]?.trim() || maThua.split('_')[1],
            dien_tich: row[24]?.trim() || '',
            loai_dat: row[27]?.trim() || '',
            thon_xa: row[11]?.trim() || row[22]?.trim() || '',
          };
        }
      }
    }
    
    console.log('Total parcels hidden by Col A [7916..9250]:', hiddenByColA.size);
    console.log('Total valid GGS codes outside hidden range:', ggsCodesSet.size);
    
    // 2. Quét các thửa thuộc loại đất BCS < 100m2 trong parcels.json
    const parcels = JSON.parse(fs.readFileSync('public/data/parcels.json', 'utf8'));
    const hiddenBcs = new Set();
    
    parcels.forEach(p => {
      const ld = (p.loai_dat || '').trim().toUpperCase();
      const dt = parseFloat(String(p.dien_tich || '').replace(',', '.'));
      if (ld === 'BCS' && !isNaN(dt) && dt < 100) {
        hiddenBcs.add(p.ma_thua);
      }
    });
    
    console.log('Total parcels hidden by BCS < 100m2:', hiddenBcs.size);
    
    // Gộp toàn bộ danh mục ẩn
    const allHidden = new Set([...hiddenByColA, ...hiddenBcs]);
    console.log('Total combined hidden parcels:', allHidden.size);
    
    // Kiểm tra các thửa cụ thể
    console.log('Is 162_388 hidden?', allHidden.has('162_388'));
    console.log('Is 162_361 hidden?', allHidden.has('162_361'));
    console.log('Is 162_361 in ggsCodesSet (digitized)?', ggsCodesSet.has('162_361'));
    
    fs.writeFileSync('scripts/audit_res.json', JSON.stringify({
      totalHidden: allHidden.size,
      hiddenByColA: Array.from(hiddenByColA),
      hiddenBcs: Array.from(hiddenBcs),
      allHidden: Array.from(allHidden),
      totalGgsCodes: ggsCodesSet.size,
      sampleGgsCodes: Array.from(ggsCodesSet).slice(0, 20)
    }, null, 2));
  });
}
