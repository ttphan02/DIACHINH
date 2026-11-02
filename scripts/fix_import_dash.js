const fs = require('fs');
const path = 'src/components/DashboardClient.tsx';
let content = fs.readFileSync(path, 'utf8');

const target = "import type { ReadyToPackItem } from '@/utils/pdfPacker';";
const addition = "import type { ReadyToPackItem } from '@/utils/pdfPacker';\nimport digitizedBlueParcelsData from '@/data/digitized_blue_parcels.json';\nconst DIGITIZED_BLUE_SET = new Set(digitizedBlueParcelsData as string[]);";

if (content.includes(target)) {
  content = content.replace(target, addition);
  fs.writeFileSync(path, content, 'utf8');
  console.log('Successfully added import to DashboardClient.tsx');
} else {
  console.log('Target not found');
}
