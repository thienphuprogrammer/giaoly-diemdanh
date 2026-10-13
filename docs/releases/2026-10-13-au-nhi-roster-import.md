# Nhập danh sách Ấu Nhi 1, năm học 2026–2027

Đã nhập vào production https://giaoly-diemdanh.vercel.app ngày 13/10/2026.

Nguồn: file người dùng gửi `DANH SÁCH ĐẦU NĂM (2026-2027) - ẤU NHI 1.xlsx`, SHA-256 `c60fffb348573ac2d2f5732ee8d485efad9505fdbebdf4959538aae9cd967009`.

Người dùng xác nhận tạo khối Ấu Nhi 1, năm lớp và nhập đủ 208 dòng; tên trùng giữa các lớp được giữ thành hồ sơ riêng theo file. Không tự gộp khi nguồn thiếu ngày sinh.

| Lớp | Đã nhập | ID lớp |
|---|---:|---|
| ẤU NHI 1A | 41 | b7157040-b69e-47a8-8bce-e5408d6f683b |
| ẤU NHI 1B | 43 | 581c69ed-06fc-43f6-90da-544469fc571e |
| ẤU NHI 1C | 42 | 295eb329-7565-4cc6-ba03-6b6d31e80e44 |
| ẤU NHI 1D | 41 | aa8fdb79-1f95-46ca-a24c-1fd295e8db76 |
| ẤU NHI 1E | 41 | 56615c89-9586-490b-9cfe-8fa2a6002d8d |

Năm học: `c30e484d-3e03-47a5-95fe-ec27b694559c`; khối: `7c940eb7-6365-4a76-8984-c8ad0c09880f`.

Ghép họ tên từ cột C và D, giữ tên thánh; lớp cũ năm 2025–2026 và ghi chú được lưu trong trường Ghi chú. Nguồn không có ngày sinh hoặc SĐT phụ huynh nên để trống, không suy đoán. Không tạo lịch sử điểm danh cho năm cũ từ tên lớp cũ.

Lượt nhập sử dụng dịch vụ ứng dụng trong một transaction, kiểm tra admin sau ADMIN_LOCK, bảo vệ nhập lặp và đối chiếu đủ từng trường trước commit. Kết quả: 208 đã thêm, 0 bỏ qua, 208 đối chiếu khớp. Có 208 membership và QR riêng; năm nhật ký student.import. Kiểm tra sau commit và mở cả năm danh sách lớp trên production hoàn tất thành công.

Không lưu tên thiếu nhi, liên hệ, QR token hoặc thông tin kết nối trong báo cáo này. Các tệp thao tác trong /tmp đã mất khi môi trường chạy tạm khởi động lại; dữ liệu đã commit nằm trên database production.
