# ShinJin POP Rework

신진 MES/POP의 React 및 Spring Boot 전환 프로젝트입니다. 시작 화면에서 API 연결을 확인할 수 있습니다.

## 개발 환경

Java 17, Maven 3.6.3 이상, Node.js 22.12 이상 및 npm이 필요합니다.

PowerShell 터미널 1에서 API를 실행합니다.

```powershell
cd src/api
mvn.cmd spring-boot:run
```

PowerShell 터미널 2에서 웹을 실행합니다.

```powershell
cd src/web
npm.cmd ci
npm.cmd run dev
```

브라우저에서 http://localhost:5173 을 엽니다. Vite는 `/api`를 기본값 `127.0.0.1:5080`에 전달합니다. 배포 시 같은 출처에서 웹 정적 파일과 `/api`를 제공하는 구성을 권장합니다.

## 설정

POP와 ERP 연결은 `SHINJIN_DB_POP_URL`과 `SHINJIN_DB_ERP_URL`로 각각 설정합니다. SQL 인증을 사용하는 경우 각 `URL`에 대응하는 `USERNAME`과 `PASSWORD` 환경 변수를 지정합니다. 로컬 개발에서는 `src/api/application.local.properties`에 `shinjin.db.pop.url`, `shinjin.db.erp.url`, 필요 시 같은 접두사의 `username`, `password`를 넣을 수 있습니다. API는 이 파일을 실행 디렉터리에서 읽습니다. 실제 값은 Git, 브라우저 및 `VITE_` 변수에 두지 않습니다.

현재 API는 `GET /api/health/live`를 제공하며, 이 요청과 애플리케이션 시작에는 DB 연결이 필요 없습니다.

## 빌드

```powershell
mvn.cmd -f src/api/pom.xml verify
cd src/web
npm.cmd ci
npm.cmd run lint
npm.cmd run build
```

백엔드 결정과 리포트 검증 기준은 [전환 설계](docs/migration.md)에 있습니다.
