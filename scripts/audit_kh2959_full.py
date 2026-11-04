import urllib.request
import json
import concurrent.futures
import time
import sys
import os

sys.stdout.reconfigure(encoding='utf-8')

def main():
    print(">>> BẮT ĐẦU ĐỐI SOÁT REAL-TIME VỚI WEB KH2959 (kh2959bmt.net)...")
    
    # 1. Đọc dữ liệu parcels
    with open('public/data/parcels.json', 'r', encoding='utf-8') as f:
        parcels = json.load(f)
    parcel_dict = {p['ma_thua']: p for p in parcels}

    # 2. Đọc hidden & digitized
    with open('src/data/hidden_parcels.json', 'r', encoding='utf-8') as f:
        hidden = set(json.load(f))
    with open('src/data/digitized_parcels.json', 'r', encoding='utf-8') as f:
        dig = set(json.load(f))

    # 3. Đọc sync_sheets từ R2 cache
    req = urllib.request.Request('https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/cache/sync_sheets.json', headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=10) as resp:
        sheets_data = json.loads(resp.read().decode('utf-8')).get('sheetsData', {})

    # 4. Đọc declarations từ R2
    req2 = urllib.request.Request('https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/declarations/all.json', headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req2, timeout=10) as resp:
        decl_data = json.loads(resp.read().decode('utf-8'))
    decl_map = decl_data.get('declarationsMap', {})

    ready_rows = [r[1] for r in sheets_data.get('THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)', [])[1:] if len(r) > 1 and r[1]]
    chua_cccd_rows = [r[1] for r in sheets_data.get('THỬA ĐANG KÊ KHAI(CHƯA CÓ CCCD)', [])[1:] if len(r) > 1 and r[1]]

    targets_dang_ke_khai = []
    seen = set()
    for m in ready_rows:
        if m not in seen and '_' in m:
            seen.add(m)
            p = m.split('_')
            d = decl_map.get(m, {})
            targets_dang_ke_khai.append({
                'ma_thua': m,
                'so_to': p[0],
                'so_thua': p[1],
                'group': 'Có CCCD (Sẵn sàng đóng tập)',
                'owner': d.get('chu_dat_ten') or d.get('chu_ho') or '',
                'cccd': d.get('chu_dat_cccd') or d.get('cccd') or '',
                'thon_xa': d.get('thon_xa') or d.get('dia_chi_thua_dat') or '',
            })

    for m in chua_cccd_rows:
        if m not in seen and '_' in m:
            seen.add(m)
            p = m.split('_')
            d = decl_map.get(m, {})
            targets_dang_ke_khai.append({
                'ma_thua': m,
                'so_to': p[0],
                'so_thua': p[1],
                'group': 'Chưa CCCD (Đang kê khai)',
                'owner': d.get('chu_dat_ten') or d.get('chu_ho') or '',
                'cccd': d.get('chu_dat_cccd') or d.get('cccd') or '',
                'thon_xa': d.get('thon_xa') or d.get('dia_chi_thua_dat') or '',
            })

    # Thửa chưa làm: chưa có trong hidden, dig, decl_map, seen
    targets_chua_lam = []
    for p in parcels:
        m = p['ma_thua']
        if m in hidden or m in dig or m in decl_map or m in seen:
            continue
        parts = m.split('_')
        targets_chua_lam.append({
            'ma_thua': m,
            'so_to': parts[0],
            'so_thua': parts[1],
            'group': 'Chưa làm',
            'owner': p.get('chu_ho') or '',
            'cccd': p.get('cccd') or '',
            'thon_xa': p.get('thon_xa') or '',
        })

    print(f"- Số thửa Đang kê khai: {len(targets_dang_ke_khai)} thửa (Có CCCD: {len(ready_rows)}, Chưa CCCD: {len(chua_cccd_rows)})")
    print(f"- Số thửa Chưa làm (Chưa kê khai): {len(targets_chua_lam)} thửa")
    all_targets = targets_dang_ke_khai + targets_chua_lam
    print(f"=> Tổng cộng cần kiểm tra: {len(all_targets)} thửa")

    def check_single(item):
        to = item['so_to']
        thua = item['so_thua']
        url = f"https://www.kh2959bmt.net/api/nhom4/kiem-tra-trung-thua?ma_xa=24478&so_to={to}&so_thua={thua}"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.kh2959bmt.net/nhom-4'})
        
        for attempt in range(2):
            try:
                with urllib.request.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read().decode('utf-8'))
                    return {
                        **item,
                        'ton_tai': bool(data.get('ton_tai')),
                        'trung': bool(data.get('trung')),
                        'nhom_1_2': bool(data.get('nhom_1_2')),
                        'phan_loai': data.get('phan_loai'),
                    }
            except Exception as e:
                if attempt == 1:
                    return {**item, 'error': str(e)}
                time.sleep(0.2)
        return {**item, 'error': 'timeout'}

    start_time = time.time()
    results = []
    done_count = 0
    total = len(all_targets)

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as executor:
        future_to_item = {executor.submit(check_single, item): item for item in all_targets}
        for future in concurrent.futures.as_completed(future_to_item):
            res = future.result()
            results.append(res)
            done_count += 1
            if done_count % 200 == 0 or done_count == total:
                elapsed = time.time() - start_time
                rate = done_count / elapsed
                pct = (done_count / total) * 100
                print(f"Tiến độ: {done_count}/{total} ({pct:.1f}%) | Tốc độ: {rate:.1f} req/s | Thời gian: {elapsed:.0f}s")

    total_time = round(time.time() - start_time, 1)
    print(f"\n Hoàn tất kiểm tra {len(results)} thửa trong {total_time}s!\n")

    # Phân loại thống kê
    def categorize_list(items):
        cat = {
            'total': len(items),
            'chua_nhap': [],
            'nhom_1_2': [],
            'khong_ton_tai': [],
            'trung': [],
            'error': []
        }
        for r in items:
            if r.get('error'):
                cat['error'].append(r)
            elif r.get('trung'):
                cat['trung'].append(r)
            elif r.get('nhom_1_2'):
                cat['nhom_1_2'].append(r)
            elif not r.get('ton_tai'):
                cat['khong_ton_tai'].append(r)
            else:
                cat['chua_nhap'].append(r)
        return cat

    dkk_results = [r for r in results if r['group'] != 'Chưa làm']
    cl_results = [r for r in results if r['group'] == 'Chưa làm']

    stats_dkk = categorize_list(dkk_results)
    stats_cl = categorize_list(cl_results)
    stats_all = categorize_list(results)

    print("================================================================================")
    print("                     BÁO CÁO ĐỐI SOÁT WEB KH2959BMT.NET                         ")
    print("================================================================================")
    
    print(f"\n1. NHÓM ĐANG KÊ KHAI (Tổng: {stats_dkk['total']} thửa):")
    print(f"   - Chưa nhập trên web (cần nhập):                                 {len(stats_dkk['chua_nhap'])} thửa")
    print(f"   - Thuộc Nhóm 1 / Nhóm 2 (đã có dữ liệu từ trước, không cần nhập): {len(stats_dkk['nhom_1_2'])} thửa")
    print(f"   - Không tồn tại trong dữ liệu thửa đất (thua_dat):               {len(stats_dkk['khong_ton_tai'])} thửa")
    print(f"   - Đã nộp trên web (trùng hồ sơ nhóm 4):                          {len(stats_dkk['trung'])} thửa")

    print(f"\n2. NHÓM CHƯA LÀM (Tổng: {stats_cl['total']} thửa):")
    print(f"   - Chưa nhập trên web (cần nhập):                                 {len(stats_cl['chua_nhap'])} thửa")
    print(f"   - Thuộc Nhóm 1 / Nhóm 2 (đã có dữ liệu từ trước, không cần nhập): {len(stats_cl['nhom_1_2'])} thửa")
    print(f"   - Không tồn tại trong dữ liệu thửa đất (thua_dat):               {len(stats_cl['khong_ton_tai'])} thửa")
    print(f"   - Đã nộp trên web (trùng hồ sơ nhóm 4):                          {len(stats_cl['trung'])} thửa")

    print(f"\n3. TỔNG HỢP CẢ 2 NHÓM (Tổng: {stats_all['total']} thửa):")
    print(f"   - Chưa nhập trên web (cần nhập):                                 {len(stats_all['chua_nhap'])} thửa")
    print(f"   - Thuộc Nhóm 1 / Nhóm 2 (không cần nhập):                        {len(stats_all['nhom_1_2'])} thửa")
    print(f"   - Không tồn tại trong dữ liệu (thua_dat):                        {len(stats_all['khong_ton_tai'])} thửa")
    print(f"   - Đã nộp trên web:                                               {len(stats_all['trung'])} thửa")
    print("================================================================================\n")

    # Lưu chi tiết ra file JSON để người dùng tra cứu danh sách cụ thể
    summary_output = {
        'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
        'total': total,
        'dang_ke_khai': {
            'total': stats_dkk['total'],
            'chua_nhap_count': len(stats_dkk['chua_nhap']),
            'nhom_1_2_count': len(stats_dkk['nhom_1_2']),
            'khong_ton_tai_count': len(stats_dkk['khong_ton_tai']),
            'trung_count': len(stats_dkk['trung']),
            'nhom_1_2_list': stats_dkk['nhom_1_2'],
            'khong_ton_tai_list': stats_dkk['khong_ton_tai'],
            'trung_list': stats_dkk['trung'],
        },
        'chua_lam': {
            'total': stats_cl['total'],
            'chua_nhap_count': len(stats_cl['chua_nhap']),
            'nhom_1_2_count': len(stats_cl['nhom_1_2']),
            'khong_ton_tai_count': len(stats_cl['khong_ton_tai']),
            'trung_count': len(stats_cl['trung']),
            'nhom_1_2_list': stats_cl['nhom_1_2'],
            'khong_ton_tai_list': stats_cl['khong_ton_tai'],
            'trung_list': stats_cl['trung'],
        },
        'all_chua_nhap_count': len(stats_all['chua_nhap']),
        'all_nhom_1_2_count': len(stats_all['nhom_1_2']),
        'all_khong_ton_tai_count': len(stats_all['khong_ton_tai']),
        'all_trung_count': len(stats_all['trung']),
    }

    out_path = 'public/data/kh2959_audit_summary.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(summary_output, f, ensure_ascii=False, indent=2)
    print(f"Đã lưu báo cáo chi tiết vào file: {out_path}")

if __name__ == '__main__':
    main()
