# ScanName - PDF Splitter Pro & CCCD Auto-Matcher

Ứng dụng web cục bộ xử lý tách ghép PDF, quét nhận diện CCCD 12 số (AI Gemini & Regex trang 1), tra cứu Google Sheet và tự động chèn trang CCCD.

---

## 🚀 Cách Khởi Chạy
1. **Cách 1 (Nhanh nhất):** Nhấp đúp chuột vào file `run.bat` trong thư mục này.
2. **Cách 2 (Dòng lệnh):**
   ```cmd
   cd ScanName
   python server.py
   ```
3. **Cách 3 (Không cần server):** Mở trực tiếp file `pdf_splitter.html` hoặc `index.html` bằng trình duyệt Chrome/Edge.

---

## 📁 Cấu Trúc Gói Thư Mục `ScanName`
- `index.html` / `pdf_splitter.html`: Giao diện chính của ứng dụng.
- `server.py`: Máy chủ cục bộ FastAPI + PyMuPDF phục vụ xử lý file và MIME types.
- `run.bat`: File kích hoạt 1 chạm trên Windows.
- `assets/css/`: Toàn bộ style giao diện (tối ưu hóa 0% GPU, không làm nóng máy).
- `assets/js/`: Mã nguồn logic chia nhỏ theo từng module (Session Storage, PDF Engine, Group Manager, CCCD Matcher, OCR, Gemini Vision, Google Sheet).
- `assets/vendor/`: Toàn bộ thư viện chạy offline (PDF.js, PDF-lib, JSZip, FontAwesome, Webfonts).
- `data/gemini_keys.json`: Danh sách API Key Gemini đã lưu.
