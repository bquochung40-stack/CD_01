# Thiết kế mạng và ma trận chính sách

## Mục tiêu

Chỉ cho phép người dùng đến web, web đến API, API đến database. Các kết nối ngang tầng hoặc đi tắt tới database phải thất bại. Thử nghiệm đặt trong namespace nau-lab; namespace nau-lab-test chứa pod kiểm thử.

    Người dùng / test pod
             |
             v TCP 80
           [WEB] -- TCP 3000 --> [API] -- TCP 5432 --> [DB]

Web dùng Nginx để phục vụ giao diện và chuyển /api/ tới API. Trình duyệt không gọi API trực tiếp, nên API không cần công bố ra host. Các container/pod liên lạc qua DNS của Docker hoặc Kubernetes, không dùng địa chỉ IP tĩnh trong mã nguồn.

## Quy hoạch IP

| Môi trường | Vùng | CIDR / tên | Thành viên |
|---|---|---|---|
| Docker | frontend | 172.28.10.0/24 | web, probe tạm |
| Docker | backend | 172.28.20.0/24 | web, api, probe tạm |
| Docker | data, internal | 172.28.30.0/24 | api, db, probe tạm |
| kind | Pod network | 10.244.0.0/16 | Pod do Calico hoặc Cilium cấp IP, chạy trên hai cụm riêng |
| kind | Namespace ứng dụng | nau-lab | web, api, db |
| kind | Namespace thử nghiệm | nau-lab-test | probe được duyệt và probe khác |
| Cisco GNS3 | client / api / data | 10.10.10.0/24, 10.10.20.0/24, 10.10.30.0/24 | ba LAN độc lập |

Docker có thể báo trùng subnet nếu máy đang dùng các dải 172.28.x.x; khi đó đổi đồng bộ ba subnet trong compose.yaml và bảng này.

## Ma trận chính sách bắt buộc

| Source | Destination | Port | Docker Compose | Kubernetes NetworkPolicy | Lý do |
|---|---|---:|---|---|---|
| Trình duyệt/host | web | 80 (host 8080) | Cho phép | Port-forward để demo | Điểm vào |
| Probe được duyệt | web | TCP 80 | Cho phép | Cho phép | Test ingress hợp lệ |
| Probe không được duyệt | web | TCP 80 | Cùng frontend thì cho phép | Chặn | K8s lọc được theo namespace + label |
| Probe ngoài | api | TCP 3000 | Chặn nếu chỉ thuộc frontend | Chặn | Không đi tắt qua web |
| Probe ngoài | db | TCP 5432 | Chặn | Chặn | Không truy cập DB trực tiếp |
| web | api | TCP 3000 | Cho phép | Cho phép | Tra cứu/lưu công thức |
| web | db | TCP 5432 | Chặn | Chặn | Web không thấy dữ liệu trực tiếp |
| api | db | TCP 5432 | Cho phép | Cho phép | Truy vấn PostgreSQL |
| api | web | TCP 80 | Cùng backend thì cho phép | Chặn | NetworkPolicy có hướng, Docker bridge không có |
| db | api | TCP 3000 | Cùng data thì cho phép | Chặn | NetworkPolicy có hướng |
| web/api | CoreDNS | UDP/TCP 53 | Docker DNS nội bộ | Cho phép | Phân giải tên service |
| db | mạng ngoài | mọi cổng | Chặn bởi internal network | Chặn bởi default deny egress | Giảm lộ dữ liệu |

Trên Docker, chỉ cần cùng bridge là có thể kết nối hai chiều; Docker network không thay thế firewall theo từng cổng. Ba bridge làm rõ phân vùng, còn Kubernetes NetworkPolicy thể hiện khả năng lọc theo hướng, pod, namespace và port. Đối với Docker, “probe được duyệt/không được duyệt” đều có cùng quyền nếu cùng network; đây là điểm so sánh, không phải lỗi cấu hình.

## Quy tắc Kubernetes

1. Áp dụng default-deny cho Ingress và Egress của mọi pod trong nau-lab.
2. Mở ingress web TCP 80 chỉ từ pod role=probe ở namespace role=lab-test.
3. Mở ingress API TCP 3000 chỉ từ pod tier=web cùng namespace. Cụm Calico dùng `calico-web-api.yaml` ở L4; cụm Cilium dùng `cilium-l7.yaml` để xét thêm HTTP method/path. Không áp cả hai luật vào cùng cụm.
4. Mở ingress DB TCP 5432 chỉ từ pod tier=api cùng namespace.
5. Mở egress web→API và API→DB tương ứng.
6. Mở DNS 53 cho web và API tới CoreDNS trong kube-system. DB không có egress.

Pod test nằm trong namespace khác để minh họa namespaceSelector. Probe web/api mang nhãn tier tương ứng nhưng không có nhãn app, nên service không gửi lưu lượng sản phẩm đến probe. Xóa probe sau khi lấy bằng chứng nếu không còn dùng.

## Quy tắc L7 và kiểm thử liên tục

Trong cụm Cilium, chính sách `web-to-api-http` chọn pod tier=api và chỉ nhận request từ pod tier=web trên TCP 3000. Các đường dẫn công thức có method tương ứng được cho qua; GET `/health`, method sai và đường dẫn sai trả HTTP 403 ở proxy L7. Quy tắc egress web→API ở L4 vẫn cần để luồng đi được; luật ingress L4 rộng trên API thì không được áp vì sẽ làm mất tác dụng lọc L7. Kubelet vẫn kiểm tra `/health` từ host theo cơ chế health probe của cụm.

Workflow tại `.github/workflows/network-policy.yml` tạo cụm Cilium mới ở mỗi lần chạy, áp chính sách trước workload, rồi kiểm thử 8 luồng mạng và 11 request HTTP. Bằng chứng JSON được tải qua artifact; khi lỗi, artifact còn có trạng thái pod và log Cilium. Đây là kiểm thử thực nghiệm với pod thật, không chỉ kiểm tra cú pháp cấu hình.

## Bảng đối chiếu ACL Cisco ↔ iptables ↔ NetworkPolicy

| Thuộc tính | ACL Cisco IOS | iptables Linux | K8s NetworkPolicy |
|---|---|---|---|
| Nơi áp dụng | Interface router, hướng in/out | Chain INPUT/OUTPUT/FORWARD ở host/network namespace | Pod theo selector, do CNI thực thi |
| Đối tượng | IP, wildcard mask, giao thức, port | IP/CIDR, giao thức, port, interface, state/conntrack | Pod/namespace/IP block, giao thức, port |
| Mặc định khi đã áp ACL/policy | Implicit deny cuối ACL | Phụ thuộc policy của chain | Pod chưa chọn bởi policy thì không bị cô lập; default-deny phải tạo rõ |
| Tính trạng thái | ACL thuần không theo dõi session; established chỉ kiểm tra cờ TCP | Có thể dùng conntrack, ESTABLISHED/RELATED | Kết nối được cho phép có phản hồi tương ứng |
| Định danh workload động | Khó; chủ yếu IP/subnet | Khó nếu tự viết rule | Label pod và namespace |
| Ví dụ web→API | Permit tcp source web đến API eq 3000 trên interface vào | FORWARD allow tcp web → api dport 3000 | Ingress API from tier=web TCP 3000 + Egress web to tier=api |
| Giới hạn | Cấu hình tuyến tính, dễ quên chiều phản hồi | Rule phụ thuộc host và thứ tự chain | L3/L4; lọc HTTP method/path cần công nghệ L7 bổ sung |

Kịch bản Cisco khả thi và cấu hình mẫu nằm ở router-lab/. Không lấy bảng so sánh này thay cho bằng chứng thực nghiệm; phải chạy lab để chụp kết quả.

Minh họa quy tắc iptables trên một Linux router **cô lập trong lab** (không áp vào host đang sử dụng):

    iptables -A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
    iptables -A FORWARD -s 10.10.10.10 -d 10.10.20.10 -p tcp --dport 3000 -j ACCEPT
    iptables -A FORWARD -s 10.10.20.10 -d 10.10.30.10 -p tcp --dport 5432 -j ACCEPT
    iptables -P FORWARD DROP

Các rule trên minh họa cho phép hai luồng ứng dụng và phản hồi theo conntrack. Cần bật IP forwarding và có ba interface/subnet tương ứng khi thực nghiệm. ACL IOS mẫu dùng điều kiện established trên cờ TCP thay vì conntrack.

## Tài liệu liên quan

- Bài giảng 1: phân mạng/VLAN và hạ tầng nhiều mạng.
- Bài giảng 3: wildcard mask, ACL standard/extended, vị trí in/out, implicit deny.
- Bài giảng 4: packet-filtering firewall so với stateful firewall.
- Đề tài tiểu luận số 1: yêu cầu ba tầng, Docker, Kubernetes, ma trận và kiểm thử.
