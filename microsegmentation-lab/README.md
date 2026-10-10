# Đề tài 1: Phân đoạn vi mô cho Nấu Ăn Ngon

Lab độc lập lấy chức năng quản lý công thức nấu ăn làm tình huống thực nghiệm. Mã nguồn website cũ đã được chuyển sang thư mục lưu trữ bên cạnh dự án và không cần để chạy lab. Lab có giao diện quản lý và CRUD công thức với ảnh món ăn, loại món, thời gian nấu, nguyên liệu, cách làm, tìm kiếm/lọc/sắp xếp, API Node.js Express, một bảng PostgreSQL, ba Docker bridge network, router FRRouting/iptables và Kubernetes NetworkPolicy với Calico. Ảnh JPEG/PNG/WebP tối đa 2 MB được lưu trong bảng PostgreSQL, không mở thêm cổng hay dịch vụ. Khi khởi động, API tự thêm các cột mới vào bảng cũ mà không xóa công thức đã lưu.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| api/ | API Express, truy vấn PostgreSQL có tham số, kiểm thử HTTP |
| web/ | Giao diện công thức và Nginx reverse proxy |
| db/ | Schema một bảng và ba công thức mẫu |
| kind/, k8s/ | Cụm kind, workload, chính sách mạng, probe |
| probe/ | Image Alpine nhỏ chứa curl và nc cho kiểm thử trong Kubernetes |
| router-lab/ | Router FRRouting/iptables chạy được, cùng cấu hình ACL Cisco IOS để đối chiếu |
| scripts/ | Triển khai kind và chạy kiểm thử luồng mạng |
| docs/ | Sơ đồ, ma trận chính sách, bảng đối chiếu và hướng dẫn demo |

## Yêu cầu máy

- Docker Engine hoặc Docker Desktop chạy Linux containers; Docker Compose v2.
- Node.js 20+ để chạy kiểm thử tự động.
- Kubernetes: kind và kubectl; thêm Helm 3 để chạy phần Cilium L7. Máy 12 GB RAM nên chạy từng phần tuần tự và đóng các ứng dụng khác trước khi tạo cluster.
- Cấu hình này ghim kind Kubernetes v1.35.0 và Calico v3.33.0; xem tài liệu Calico trước khi đổi phiên bản.
- kind được cấu hình một node để giảm tải RAM; vẫn đủ nhiều pod để kiểm chứng NetworkPolicy.

Máy Windows hiện tại đã cài Docker Desktop, Node.js, kind và kubectl. Hướng dẫn demo theo từng bước nằm tại [docs/huong-dan-demo.md](docs/huong-dan-demo.md); hướng dẫn chuẩn bị máy khác tại docs/setup-windows.md.

## 1. Chạy Docker Compose

Mở PowerShell và chuyển vào đúng thư mục chứa `compose.yaml`:

    cd "C:\Workspace C\NauComNgon_web-main\microsegmentation-lab"
    if (-not (Test-Path .env)) { Copy-Item .env.example .env }

Sửa POSTGRES_PASSWORD trong .env, rồi chạy:

    docker compose up --build -d
    docker compose ps
    node scripts/test-network.js docker

Mở http://localhost:8080. Cổng 8080 chỉ gắn với 127.0.0.1 trên host. API và PostgreSQL không công bố cổng ra host. Nếu cổng 8080 đang bận, đổi cổng bên trái trong compose.yaml. Sau khi xong:

    docker compose down

Giữ volume dữ liệu để demo tiếp; chỉ dùng docker compose down -v khi chủ ý xóa dữ liệu lab.

Nếu PowerShell đang ở thư mục `NauComNgon_web-main` thì `docker compose ps/down` báo `no configuration file provided: not found`. Hãy chạy lại dòng `cd` ở trên trước khi dùng các lệnh Compose hoặc `node scripts/...`. Không cần cài lại Docker hay xóa dữ liệu.

## 2. Chạy router FRRouting/iptables

    docker compose -f router-lab/compose.yaml up --build -d
    node router-lab/test-router.js
    docker compose -f router-lab/compose.yaml down

Mô hình ba LAN chạy được trên Docker; tệp router-lab/r1-ios.cfg là cấu hình Cisco IOS tương đương. Xem router-lab/README.md.

## 3. Chạy Kubernetes với kind + Calico

Từ PowerShell trong thư mục microsegmentation-lab:

    .\scripts\deploy-kind.ps1
    node scripts/test-network.js k8s
    kubectl -n nau-lab port-forward svc/web 8080:80

Mở http://localhost:8080 khi port-forward đang chạy. Port-forward chỉ phục vụ thao tác giao diện; bằng chứng NetworkPolicy lấy từ các probe pod trong hai namespace và tệp kết quả của script. Khi kết thúc lab:

    kind delete cluster --name nau-segmentation

Script triển khai sẽ dừng nếu cluster cùng tên đã tồn tại để tránh sửa nhầm cluster đang dùng. Nếu đã triển khai trước đó, chạy `.\scripts\deploy-kind.ps1 -ReuseExisting` để kiểm tra và dùng lại cụm Calico cùng website hiện có, giữ nguyên dữ liệu. Tùy chọn này không build lại image hoặc triển khai thay đổi mã nguồn; nếu cụm thiếu thành phần, script báo lỗi kiểm tra.

## 4. Kiểm tra API

    cd api
    npm ci
    npm test

Giao diện gọi:

| Phương thức | Đường dẫn | Kết quả |
|---|---|---|
| GET, POST | /api/recipes | Danh sách / thêm món |
| GET, PUT, DELETE | /api/recipes/:id | Xem / sửa / xóa món |
| GET | /api/recipes/:id/image | Trả ảnh món ăn nếu có |
| GET | /health | Kiểm tra API và kết nối DB |

API chỉ phục vụ lab, không có tài khoản người dùng. Không công bố lab này ra Internet.

## 5. Mục nâng cao: Cilium HTTP L7

Chạy cụm Cilium **riêng** với cụm Calico. Trong PowerShell, từ thư mục lab:

    .\scripts\deploy-cilium.ps1
    node scripts/test-network.js cilium
    node scripts/test-l7.js

Chính sách [k8s/cilium-l7.yaml](k8s/cilium-l7.yaml) chỉ cho web gọi các API công thức đúng method/path: GET/POST danh sách, GET/PUT/DELETE món theo ID số và GET ảnh. GET /health từ pod web, method sai và đường dẫn sai nhận HTTP 403. Luật Calico web→API L4 nằm riêng tại [k8s/calico-web-api.yaml](k8s/calico-web-api.yaml) và không áp dụng trong cụm Cilium; luật đó nếu áp dụng cùng sẽ bỏ qua bộ lọc HTTP L7. Kết quả được ghi ở evidence/cilium-network-test.json và evidence/cilium-l7-test.json.

Sau demo:

    kind delete cluster --name nau-l7

Không chạy hai cụm kind cùng lúc trên máy 12 GB RAM.

## 6. Mục nâng cao: GitHub Actions

[.github/workflows/network-policy.yml](../.github/workflows/network-policy.yml) tự dựng kind + Cilium trên runner Ubuntu, triển khai website cùng chính sách, chạy API tests, 8 ca phân đoạn L3/L4 và 11 ca HTTP L7. Mỗi lần push hoặc mở pull request có thay đổi lab, workflow chạy và lưu kết quả JSON dưới artifact `network-policy-evidence`; khi lỗi sẽ kèm trạng thái pod, chính sách và log Cilium. Có thể chạy thủ công qua **Actions → Network policy checks → Run workflow**.

Để kích hoạt Actions, đặt cả thư mục `microsegmentation-lab` và `.github/workflows` trong **cùng một repository GitHub** rồi push. Tệp workflow phải nằm ở gốc repository, không đặt trong thư mục lab.

## Bằng chứng cần lưu

Script kiểm thử ghi tệp evidence/docker-network-test.json, evidence/router-network-test.json, evidence/k8s-network-test.json, evidence/cilium-network-test.json và evidence/cilium-l7-test.json với thời điểm, mã thoát, kết quả kỳ vọng và thực tế. Thư mục evidence không đưa vào Git. Xem docs/architecture.md và docs/huong-dan-demo.md để trình bày kết quả.

Script .\scripts\security-scan.ps1 quét dependency và image bằng npm audit/Trivy. Image PostgreSQL chính thức hiện còn cảnh báo thư viện Go trong gosu; kết quả được ghi trung thực ở evidence/security-summary.json.

## Nguồn kỹ thuật chính

- Docker Compose networks: https://docs.docker.com/reference/compose-file/networks/
- Kubernetes NetworkPolicy: https://kubernetes.io/docs/concepts/services-networking/network-policies/
- Calico trên kind: https://docs.tigera.io/calico/latest/getting-started/kubernetes/kind
- Cilium trên kind: https://docs.cilium.io/en/stable/installation/kind/
- Cilium L7 HTTP policy: https://docs.cilium.io/en/stable/security/policy/layer7/
- GitHub Actions: https://docs.github.com/en/actions/tutorials/create-an-example-workflow
- Đề tài gốc: E:/DeTaiTieuLuan_Final.pdf, mục Đề tài 1.
