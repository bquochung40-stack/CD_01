# Website lab đề tài 1

Mã nguồn đang sử dụng nằm trong [microsegmentation-lab](microsegmentation-lab/README.md). Mở Docker Desktop, rồi chạy PowerShell:

```powershell
cd "C:\Workspace C\NauComNgon_web-main\microsegmentation-lab"
docker compose up --build -d
```

Các lệnh `docker compose ps`, `docker compose down` và `node scripts/test-network.js docker` cũng chạy từ thư mục `microsegmentation-lab`. Nếu bạn mở terminal mới ở thư mục gốc, hãy chạy lại dòng `cd` trước.

Mở [http://localhost:8080](http://localhost:8080). Kịch bản trình bày Docker, router, Kubernetes và hai mục nâng cao Cilium L7/GitHub Actions nằm trong [hướng dẫn demo](microsegmentation-lab/docs/huong-dan-demo.md). Workflow kiểm thử tự động ở [.github/workflows/network-policy.yml](.github/workflows/network-policy.yml).

Website cũ và các tệp không dùng cho lab đã được chuyển sang `C:\Workspace C\NauComNgon_web-legacy-backup-20261009` để có thể khôi phục khi cần.
