const fs = require('fs');

async function main() {
  const [declData, syncData, csv] = await Promise.all([
    fetch('https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/declarations/all.json').then(r => r.json()),
    fetch('https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/cache/sync_sheets.json').then(r => r.json()),
    fetch('https://docs.google.com/spreadsheets/d/1c2xAknmc1fx-xKBJhLp-EcmZwAAnDIgCPf-pj6wmCHc/export?format=csv&gid=0').then(r => r.text())
  ]);

  const ggsCodes = new Set();
  csv.split('\n').slice(1).forEach(l => {
    const parts = l.split(',');
    if (parts.length >= 6) {
      const to = parts[4].replace(/"/g, '').trim();
      const thua = parts[5].replace(/"/g, '').trim();
      if (to && thua) ggsCodes.add(to + '_' + thua);
    }
  });

  const codes215 = new Set(JSON.parse(fs.readFileSync('src/data/digitized_parcels.json', 'utf8')));
  const parcels = JSON.parse(fs.readFileSync('public/data/parcels.json', 'utf8'));
  const hp = new Set(JSON.parse(fs.readFileSync('public/data/hidden_parcels.json', 'utf8')));
  const declMap = declData.declarationsMap || {};
  const declCodes = new Set(declData.declaredCodes || []);

  let green = 0, blue = 0, yellow = 0, gray = 0;

  parcels.forEach(p => {
    if (hp.has(p.ma_thua) && !declMap[p.ma_thua] && !declCodes.has(p.ma_thua) && !ggsCodes.has(p.ma_thua) && !codes215.has(p.ma_thua)) return;

    const isDigitized = ggsCodes.has(p.ma_thua) || codes215.has(p.ma_thua);
    const isLocallyDeclared = declCodes.has(p.ma_thua) || Boolean(declMap[p.ma_thua]);

    let st = '';
    if (isDigitized) {
      st = 'DA_SO_HOA_XANH';
    } else if (isLocallyDeclared) {
      st = 'DA_KE_KHAI_CHUA_SO_HOA_LAM';
    } else if (p.chu_ho && p.chu_ho !== 'Không có trong dữ liệu') {
      st = 'CO_TEN_CHUA_SO_HOA_VANG';
    } else {
      st = 'CHUA_CO_TEN_XAM';
    }

    if (st === 'DA_SO_HOA_XANH') green++;
    else if (st === 'DA_KE_KHAI_CHUA_SO_HOA_LAM') blue++;
    else if (st === 'CO_TEN_CHUA_SO_HOA_VANG') yellow++;
    else gray++;
  });

  console.log('Total GGS codes:', ggsCodes.size);
  console.log('Result stats:', { total: green + blue + yellow + gray, green, blue, yellow, gray });
}

main().catch(console.error);
