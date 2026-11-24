# ShinJin POP Rework

신진 MES/POP의 React 전환 프로젝트입니다. 시작 화면에서 API 연결을 확인할 수 있습니다. 현재 API에는 프로세스 상태 확인 엔드포인트만 있습니다.

## 개발 환경

.NET 10 SDK, Node.js 22.12 이상 및 npm이 필요합니다.

PowerShell 터미널 1에서 API를 실행합니다.

```powershell
$env:ASPNETCORE_ENVIRONMENT = "Development"
dotnet run --project src/api --no-launch-profile --urls http://127.0.0.1:5080
```

PowerShell 터미널 2에서 웹을 실행합니다.

```powershell
cd src/web
npm.cmd ci
npm.cmd run dev
```

브라우저에서 http://localhost:5173 을 엽니다. Vite가 `/api`를 API로 전달합니다. 배포 시 같은 출처에서 웹 정적 파일과 `/api`를 제공하는 구성을 권장합니다.

## 설정

향후 DB 연결은 서버의 `ConnectionStrings:Pop`, `ConnectionStrings:Erp`를 사용합니다. 개발은 .NET User Secrets 또는 Git에서 제외된 `src/api/appsettings.Local.json`, 배포는 `ConnectionStrings__Pop`, `ConnectionStrings__Erp` 환경 변수 또는 배포 환경의 비밀 저장소를 사용합니다. 실제 값은 브라우저나 `VITE_` 변수에 두지 않습니다. `/api/health/live`는 DB와 독립적으로 동작합니다.

## 빌드

```powershell
dotnet restore --locked-mode
dotnet build --no-restore
cd src/web
npm.cmd ci
npm.cmd run lint
npm.cmd run build
```

백엔드 결정과 리포트 검증 기준은 [전환 설계](docs/migration.md)에 있습니다.
