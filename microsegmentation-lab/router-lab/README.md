# Lab router theo ba vùng mạng

## Chạy ngay bằng FRRouting và iptables

Từ thư mục `microsegmentation-lab`:

    docker compose -f router-lab/compose.yaml up --build -d
    node router-lab/test-router.js
    docker compose -f router-lab/compose.yaml exec router vtysh -c "show ip route"
    docker compose -f router-lab/compose.yaml exec router iptables -L FORWARD -n -v
    docker compose -f router-lab/compose.yaml down

Ba host đi qua router FRRouting ở các IP 10.10.10.1, 10.10.20.1 và 10.10.30.1. Chain FORWARD mặc định DROP; iptables chỉ cho WEB→API TCP 3000, API→DB TCP 5432 và các gói phản hồi thuộc kết nối đã được thiết lập. Script thử sáu luồng và lưu kết quả, route, bộ đếm luật vào `evidence/router-network-test.json`. Các Docker bridge ở mô hình router không đánh dấu `internal` vì cơ chế bridge đó sẽ chặn gói liên mạng trước khi đến router. Mô hình không công bố cổng ra máy host.

## Cấu hình Cisco IOS tương đương

Mô hình dựng trong GNS3/EVE-NG: một router Cisco IOSv R1 nối ba LAN độc lập. Mỗi LAN dùng một Linux host để có curl/netcat; không dùng Packet Tracer làm bằng chứng chính.

| Host | IP / gateway | Vai trò |
|---|---|---|
| WEB | 10.10.10.10/24, gateway 10.10.10.1 | Nguồn phát yêu cầu web→API |
| API | 10.10.20.10/24, gateway 10.10.20.1 | Listener TCP 3000, nguồn API→DB |
| DB | 10.10.30.10/24, gateway 10.10.30.1 | Listener TCP 5432 |

Nạp r1-ios.cfg vào router (chỉnh tên interface cho đúng image). Gắn mỗi cổng router với một segment/switch riêng. Đặt IP và default gateway trên Linux host. Trên API host, khởi động listener TCP 3000; trên DB host, listener TCP 5432. Có thể dùng netcat: nc -lk -p 3000 / nc -lk -p 5432 (cú pháp tùy phiên bản netcat). Trên WEB host thử nc -vz -w 3 10.10.20.10 3000 (phải thành công) và nc -vz -w 3 10.10.30.10 5432 (phải thất bại). Trên API host thử đến DB 5432 (thành công) và WEB 80 (thất bại). Từ DB chủ động kết nối API 3000 phải thất bại.

Kiểm tra trên R1:

    show ip interface brief
    show ip access-lists
    show running-config | section ip access-list

Chụp hit counter tăng ở dòng permit/deny và kết quả netcat của từng host. Đây là ACL stateless: câu lệnh established chỉ xét cờ TCP ACK/RST để cho lưu lượng phản hồi, không xác minh session bằng conntrack. So sánh điểm này với iptables và Kubernetes NetworkPolicy trong docs/architecture.md. Khi kiểm thử, giữ toàn bộ host trong lab cô lập.
