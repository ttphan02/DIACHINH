const fs = require('fs');

// 1. Patch src/app/page.tsx
const pagePath = 'src/app/page.tsx';
let pageContent = fs.readFileSync(pagePath, 'utf8');

// Replace lines around 597
const targetPageCode = `      const isOnGgs = isGgsLoaded ? ggsCodes.has(p.ma_thua) : false;
      const isDigitizedBlue = DIGITIZED_SET.has(p.ma_thua);
      const isLocallyDeclared = declaredParcelCodes.has(p.ma_thua) || Boolean(declarationsMap[p.ma_thua]) || isDigitizedBlue;`;

const newPageCode = `      const isDigitized = (isGgsLoaded ? ggsCodes.has(p.ma_thua) : false) || DIGITIZED_SET.has(p.ma_thua);
      const isOnGgs = isDigitized;
      const isLocallyDeclared = declaredParcelCodes.has(p.ma_thua) || Boolean(declarationsMap[p.ma_thua]);`;

if (pageContent.includes(targetPageCode)) {
  pageContent = pageContent.replace(targetPageCode, newPageCode);
  console.log('Successfully replaced targetPageCode in page.tsx (LF)');
} else {
  // Try CRLF
  const targetCRLF = targetPageCode.replace(/\n/g, '\r\n');
  const newCRLF = newPageCode.replace(/\n/g, '\r\n');
  if (pageContent.includes(targetCRLF)) {
    pageContent = pageContent.replace(targetCRLF, newCRLF);
    console.log('Successfully replaced targetPageCode in page.tsx (CRLF)');
  } else {
    console.error('targetPageCode not found in page.tsx!');
  }
}

// Make sure trang_thai check uses isDigitized
pageContent = pageContent.replace(
  'if (isOnGgs) {',
  'if (isOnGgs || DIGITIZED_SET.has(p.ma_thua)) {'
);

fs.writeFileSync(pagePath, pageContent, 'utf8');
console.log('Saved src/app/page.tsx');

// 2. Patch src/components/DashboardClient.tsx
const dashPath = 'src/components/DashboardClient.tsx';
let dashContent = fs.readFileSync(dashPath, 'utf8');

const targetDashCode = `      const isOnGgs = ggsCodes.has(p.ma_thua);
      const isDigitizedBlue = DIGITIZED_SET.has(p.ma_thua);
      const isDeclared = declaredParcelCodes.has(p.ma_thua) || Boolean(declarationsMap[p.ma_thua]) || isDigitizedBlue;`;

const newDashCode = `      const isOnGgs = ggsCodes.has(p.ma_thua) || DIGITIZED_SET.has(p.ma_thua);
      const isDeclared = declaredParcelCodes.has(p.ma_thua) || Boolean(declarationsMap[p.ma_thua]);`;

if (dashContent.includes(targetDashCode)) {
  dashContent = dashContent.replace(targetDashCode, newDashCode);
  console.log('Successfully replaced targetDashCode in DashboardClient.tsx (LF)');
} else {
  const targetCRLF = targetDashCode.replace(/\n/g, '\r\n');
  const newCRLF = newDashCode.replace(/\n/g, '\r\n');
  if (dashContent.includes(targetCRLF)) {
    dashContent = dashContent.replace(targetCRLF, newCRLF);
    console.log('Successfully replaced targetDashCode in DashboardClient.tsx (CRLF)');
  } else {
    console.error('targetDashCode not found in DashboardClient.tsx!');
  }
}

// Make sure nonGgsParcels explicitly excludes DIGITIZED_SET
dashContent = dashContent.replace(
  'const nonGgsParcels = useMemo(() => {\n    return computedParcels.filter(\n      (p) => p.trang_thai !== \'DA_SO_HOA_XANH\' && !ggsCodes.has(p.ma_thua)',
  'const nonGgsParcels = useMemo(() => {\n    return computedParcels.filter(\n      (p) => p.trang_thai !== \'DA_SO_HOA_XANH\' && !ggsCodes.has(p.ma_thua) && !DIGITIZED_SET.has(p.ma_thua)'
);
dashContent = dashContent.replace(
  'const nonGgsParcels = useMemo(() => {\r\n    return computedParcels.filter(\r\n      (p) => p.trang_thai !== \'DA_SO_HOA_XANH\' && !ggsCodes.has(p.ma_thua)',
  'const nonGgsParcels = useMemo(() => {\r\n    return computedParcels.filter(\r\n      (p) => p.trang_thai !== \'DA_SO_HOA_XANH\' && !ggsCodes.has(p.ma_thua) && !DIGITIZED_SET.has(p.ma_thua)'
);

fs.writeFileSync(dashPath, dashContent, 'utf8');
console.log('Saved src/components/DashboardClient.tsx');

// 3. Update CadastralMap.tsx tooltip text
const mapPath = 'src/components/CadastralMap.tsx';
let mapContent = fs.readFileSync(mapPath, 'utf8');
mapContent = mapContent.replace(
  '<span style="color:#10b981;font-weight:700;">🟢 Đã số hóa (GGS)</span>',
  '<span style="color:#10b981;font-weight:700;">🟢 Đã số hóa</span>'
);
fs.writeFileSync(mapPath, mapContent, 'utf8');
console.log('Saved src/components/CadastralMap.tsx');
