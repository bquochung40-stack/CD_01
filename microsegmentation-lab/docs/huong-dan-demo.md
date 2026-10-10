# Hướng dẫn demo đề tài 1

Thực hiện bằng PowerShell trên máy đã cài Docker Desktop, Node.js, kind và kubectl. Tệp `compose.yaml` và thư mục `scripts` nằm trong `C:\Workspace C\NauComNgon_web-main\microsegmentation-lab`. Mỗi nhóm lệnh có dòng `cd` để bạn có thể sao chép riêng từ một terminal mới. Chỉ chạy các dòng **bên trong** khối lệnh, không gõ các dấu ```.

## 0. Sau khi bật máy

1. Mở Docker Desktop. Đợi góc dưới bên trái hiện **Engine running**.
2. Mở PowerShell hoặc terminal VS Code, chuyển vào thư mục lab:

   ```powershell
   cd "C:\Workspace C\NauComNgon_web-main\microsegmentation-lab"
   docker version
   docker compose version
   node --version
   kind version
   kubectl version --client
   ```

3. Nếu PowerShell báo không tìm thấy `kind` dù đã cài, đóng và mở lại terminal. Tệp `.env` đã có trên máy này. Khi chuyển sang máy khác, sao chép `.env.example` thành `.env` và tự đặt `POSTGRES_PASSWORD`.

Máy 12 GB RAM nên chạy lần lượt từng phần Docker, router, Kubernetes. Không cần bật cả ba cùng lúc.

## 1. Website và CRUD qua Docker

```powershell
cd "C:\Workspace C\NauComNgon_web-main\microsegmentation-lab"
docker compose up --build -d
docker compose ps
docker compose -f "C:\Workspace C\NauComNgon_web-main\microsegmentation-lab\compose.yaml" up -d --wait; if ($LASTEXITCODE -eq 0) { Start-Process "http://localhost:8080" }
```

Đợi cả `web`, `api`, `db` hiện `healthy`. Mở [http://localhost:8080](http://localhost:8080). Nếu trang trắng hoặc không mở được, chạy `docker compose logs --tail=80 web api db`.

Trình bày theo thứ tự:

1. Chỉ vào sơ đồ **Giao diện web → API → Cơ sở dữ liệu** và trạng thái **API và dữ liệu sẵn sàng**.
2. Thêm món có tên `Món demo nhóm 3`, chọn **Món chính**, nhập thời gian nấu, nguyên liệu và cách làm. Chọn một ảnh JPEG, PNG hoặc WebP dưới 2 MB và xem trước ảnh, rồi lưu. Xem thông báo thành công và ảnh của món mới trong danh sách.
3. Gõ `Món demo nhóm 3` vào ô tìm kiếm; thử lọc **Món chính** và sắp xếp theo thời gian nấu. Nhấn **Xem nguyên liệu và cách làm** để mở chi tiết.
4. Nhấn **Sửa**, đổi mô tả hoặc thời gian nấu; thử giữ ảnh, thay ảnh hoặc nhấn **Gỡ ảnh** rồi **Cập nhật công thức**.
5. Nhấn **Xóa**, xác nhận. Món biến mất. Xóa xong có thể xóa chữ trong ô tìm kiếm và chọn **Tất cả loại món** để hiện lại các món khác.
6. Tải lại trang để cho thấy công thức và ảnh được lưu ở PostgreSQL. Với Docker Compose, volume dữ liệu còn sau khi tắt/mở container. Dữ liệu của cụm kind là lab tạm và mất khi xóa cluster.

Chạy kiểm thử phân đoạn Docker:

```powershell
cd "C:\Workspace C\NauComNgon_web-main\microsegmentation-lab"
node scripts/test-network.js docker
```

Kết quả mong đợi: **8/8 PASS**, gồm các luồng cho phép và bị chặn. Giải thích: `frontend` chỉ thấy web; web chuyển tiếp đến API qua `backend`; DB chỉ nằm trên `data` là mạng `internal`. Docker bridge kiểm soát thành viên theo mạng, vì vậy container đã vào `data` vẫn có thể gọi API; đây là giới hạn của cách phân đoạn này.

Sau phần website:

```powershell
cd "C:\Workspace C\NauComNgon_web-main\microsegmentation-lab"
docker compose down
```

Lệnh `down` giữ volume PostgreSQL và dữ liệu đã lưu. Không thêm `-v` trừ khi muốn xóa dữ liệu lab.

## 2. Router và ACL tương đương

Mô hình router chạy bằng FRRouting và iptables trong Docker, sử dụng ba LAN `10.10.10.0/24`, `10.10.20.0/24`, `10.10.30.0/24`. Tệp `router-lab/r1-ios.cfg` là cấu hình Cisco IOS tương đương để giải thích khi cần.

```powershell
cd "C:\Workspace C\NauComNgon_web-main\microsegmentation-lab"
docker compose -f router-lab/compose.yaml up --build -d
docker compose -f router-lab/compose.yaml ps
node router-lab/test-router.js
```

Kết quả mong đợi: **6/6 PASS**. Hai kết nối được phép là WEB→API TCP 3000 và API→DB TCP 5432. Các kết nối còn lại bị chặn. Xem bảng định tuyến và bộ đếm luật:

```powershell
cd "C:\Workspace C\NauComNgon_web-main\microsegmentation-lab"
docker compose -f router-lab/compose.yaml exec router vtysh -c "show ip route"
docker compose -f router-lab/compose.yaml exec router iptables -L FORWARD -n -v
docker compose -f router-lab/compose.yaml down
```

Điểm nói ngắn: ACL Cisco xét IP/cổng và chiều lưu lượng tại interface; iptables trên router lab dùng conntrack để cho gói trả lời của kết nối đã được phép; Kubernetes NetworkPolicy áp chính sách theo nhãn pod/namespace.

## 3. Kubernetes NetworkPolicy

Đảm bảo Docker website và router lab đã tắt để giảm tải RAM và nhường cổng 8080. Tạo kind cluster, cài Calico, triển khai ứng dụng và chính sách:

```powershell
cd "C:\Workspace C\NauComNgon_web-main\microsegmentation-lab"
.\scripts\deploy-kind.ps1
kubectl -n nau-lab get pods,svc,networkpolicy
node scripts/test-network.js k8s
```

Chờ cho `deploy-kind.ps1` hoàn tất; lần đầu có thể mất vài phút để tải image. Kết quả kiểm thử mong đợi: **8/8 PASS**. Chỉ vào các chính sách `default-deny`, các luật cho web/API/DB và bảng kiểm thử cho phép/bị chặn.

Để mở website từ Kubernetes, chạy lệnh sau ở **một terminal riêng** và giữ terminal đó mở:

```powershell
kubectl -n nau-lab port-forward svc/web 8080:80
```

Mở lại [http://localhost:8080](http://localhost:8080), thử thêm món và tải lại trang. Dữ liệu trong Kubernetes độc lập với volume Docker ở phần 1. `port-forward` chỉ phục vụ demo giao diện trên máy; bằng chứng NetworkPolicy là kết quả probe pod từ lệnh `test-network.js k8s`.

Khi demo xong, nhấn **Ctrl+C** ở terminal `port-forward`. Nếu không cần giữ cluster cho lần sau:

```powershell
cd "C:\Workspace C\NauComNgon_web-main\microsegmentation-lab"
kind delete cluster --name nau-segmentation
```

`deploy-kind.ps1` chủ ý dừng nếu cluster cùng tên đã tồn tại. Khi chỉ mở lại một cluster đang chạy, dùng `kubectl -n nau-lab get pods`, chạy lại bài kiểm thử hoặc `port-forward`; không chạy lại script tạo cluster.

## 4. Mục nâng cao: HTTP L7 bằng Cilium

Xóa cụm Calico trước khi tạo cụm Cilium, để máy 12 GB RAM không phải chạy hai cụm:

```powershell
cd "C:\Workspace C\NauComNgon_web-main\microsegmentation-lab"
kind delete cluster --name nau-segmentation
.\scripts\deploy-cilium.ps1
kubectl -n nau-lab get pods,networkpolicy,ciliumnetworkpolicy
node scripts/test-network.js cilium
node scripts/test-l7.js
```

Kết quả mong đợi: **8/8 PASS** cho phân đoạn L3/L4 và **11/11 PASS** cho HTTP L7. Trong kết quả L7, GET/POST `/api/recipes` và thao tác trên ID số được cho qua, còn GET `/health`, POST `/health`, DELETE trên danh sách hoặc ID không hợp lệ bị Cilium trả **403**. Với đường dẫn được cho qua nhưng món không tồn tại, API trả **404**; điều này chứng minh request đã tới ứng dụng. Bài kiểm thử tạo một món tạm, cập nhật, xóa và dọn dẹp tự động.

Muốn mở giao diện trong cụm Cilium, mở terminal khác và chạy:

```powershell
kubectl -n nau-lab port-forward svc/web 8080:80
```

Sau demo, nhấn **Ctrl+C** ở terminal port-forward, rồi chạy:

```powershell
cd "C:\Workspace C\NauComNgon_web-main\microsegmentation-lab"
kind delete cluster --name nau-l7
docker compose up -d
```

## 5. Mục nâng cao: GitHub Actions

Đặt cả thư mục `microsegmentation-lab` và `.github/workflows/network-policy.yml` tại gốc cùng một repository GitHub, rồi push. Vào tab **Actions**, chọn **Network policy checks**. Workflow tự chạy khi push hoặc mở pull request có thay đổi lab; cũng có nút **Run workflow** để chạy thủ công.

Mở một lần chạy thành công: các bước **Validate API and policy manifests**, **Test L3/L4 segmentation**, **Test HTTP method and path rules** phải màu xanh. Trong phần **Artifacts**, tải `network-policy-evidence` để chỉ vào hai tệp JSON kiểm thử Cilium. Khi một bước đỏ, tải cùng artifact để xem thêm `ci-pods.txt`, `ci-cilium-policy.txt` và `ci-cilium-logs.txt`; sửa lỗi rồi push lại. Các bài kiểm thử dùng method/path thật giữa các pod trong kind, không chỉ kiểm tra nội dung YAML.

## 6. Bằng chứng và xử lý nhanh

- Kết quả kiểm thử được ghi tại `evidence/docker-network-test.json`, `evidence/router-network-test.json`, `evidence/k8s-network-test.json`, `evidence/cilium-network-test.json`, `evidence/cilium-l7-test.json`.
- Nếu cần trình bày kiểm tra bảo mật, chạy `.\scripts\security-scan.ps1` khi Docker đang mở. Script ghi `evidence/security-summary.json` và kết quả npm audit/Trivy. Hiện API và web không có mức HIGH/CRITICAL; image PostgreSQL chính thức còn 21 HIGH và 1 CRITICAL trong công cụ `gosu`, nên script báo lỗi ở cuối. Trình bày đúng kết quả này và không nói rằng toàn bộ image đã sạch lỗ hổng.
- Nếu giảng viên yêu cầu lịch sử Git của nhóm, ba thành viên cần tự commit phần việc thực tế bằng tài khoản của mình rồi dùng `git log --oneline --all` để trình bày. Thư mục hiện tại chưa là repository Git; không dùng commit giả để thay lịch sử làm việc thật của nhóm.
- Nếu `localhost:8080` bị từ chối kết nối: chuyển vào thư mục `microsegmentation-lab`, kiểm tra `docker compose ps` hoặc terminal `port-forward` đang chạy. Docker Desktop mở **không tự chạy** các container đã dừng.
- Nếu `docker compose ps/down` báo `no configuration file provided: not found`, terminal đang ở sai thư mục. Chạy `cd "C:\Workspace C\NauComNgon_web-main\microsegmentation-lab"` rồi lặp lại lệnh. Có thể dùng `docker compose -f "C:\Workspace C\NauComNgon_web-main\microsegmentation-lab\compose.yaml" ps` khi không muốn chuyển thư mục.
- Nếu cổng 8080 đang bận: dùng `Get-NetTCPConnection -LocalPort 8080` để tìm tiến trình; tắt phiên `port-forward` cũ hoặc website Docker trước khi chuyển phần.
- Nếu cluster nặng, đóng trình duyệt và ứng dụng không cần thiết, chỉ chạy từng phần theo thứ tự trên.
