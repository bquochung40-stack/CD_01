# Chuẩn bị môi trường thực nghiệm trên Windows

Máy hiện tại có khoảng 12 GB RAM và đã cài Docker Desktop, kind, kubectl, Helm 3. Với 12 GB, chạy lần lượt Docker Compose rồi kind một node; không chạy hai cụm kind hoặc GNS3/EVE-NG đồng thời. Lần đầu tải image Cilium có thể mất vài phút.

1. Theo hướng dẫn chính thức của Docker, cài Docker Desktop cho Windows với backend WSL 2 và bật Linux containers. Nếu WSL 2 hoặc Windows feature cần quyền quản trị/restart, thực hiện trong phiên Windows có quyền thích hợp. Hướng dẫn: https://docs.docker.com/desktop/setup/install/windows-install/
2. Mở Docker Desktop và kiểm tra trong PowerShell: docker version; docker compose version; docker run --rm hello-world.
3. Cài kind theo trang chính thức: https://kind.sigs.k8s.io/docs/user/quick-start/ . Kiểm tra: kind version.
4. Cài kubectl phiên bản phù hợp với Kubernetes v1.35 của kind: https://kubernetes.io/docs/tasks/tools/install-kubectl-windows/ . Kiểm tra: kubectl version --client.
5. Cài Helm 3 theo https://helm.sh/docs/intro/install/ nếu muốn chạy mục nâng cao Cilium. Kiểm tra: helm version. Script deploy-cilium.ps1 trên máy này cũng tự tìm Helm tại thư mục cài đặt hiện có nếu lệnh helm chưa nằm trong PATH.
6. Trong thư mục microsegmentation-lab, thực hiện theo README.md. Trước khi chạy kind, dùng docker compose down. Sau khi lấy bằng chứng, xóa cụm Calico bằng kind delete cluster --name nau-segmentation hoặc cụm Cilium bằng kind delete cluster --name nau-l7 để giải phóng tài nguyên. Chạy lại docker compose up -d để mở website thường ngày.

Không bật Kubernetes tích hợp sẵn của Docker Desktop để thay kind trong bài này: manifest đã thiết kế cho kind với Calico hoặc Cilium. Chỉ kết luận chính sách hoạt động khi script test-network.js và test-l7.js ghi PASS cho cả trường hợp cho phép và chặn.
