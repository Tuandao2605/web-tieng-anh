# DLX

1. Queue chinh "Work_queue" --> Nếu lỗi --> gọi nack để chuyển sang DLX

2. Queue chờ "retry_queue" --> Lưu trữ tạm thời 10 giây, tự động đẩy sang queue chính

3. Bộ đếm : Mỗi lần quay lại queue chính --> tăng bộ đếm (Dùng header)

Giới hạn số lần quay lại queue chính: 3 lần

Nếu sau 3 lần --> vẫn lỗi --> đẩy sang DLQ để lưu trữ phân tích sau hoặc xóa bỏ
