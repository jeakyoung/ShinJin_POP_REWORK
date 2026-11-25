# ShinJin POP Rework

신진 MES/POP의 React 및 Spring Boot 전환 프로젝트입니다. 첫 전환 기능으로 합성 로그인과 작업이력 조회를 제공하며, 데이터는 API의 합성 목록으로 제공됩니다.

## 개발 환경

Java 17, Maven 3.6.3 이상, Node.js 22.12 이상 및 npm이 필요합니다.

PowerShell 터미널 1에서 API를 실행합니다.

```powershell
cd src/api
mvn.cmd "-Dspring-boot.run.profiles=demo" spring-boot:run
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

상태 확인 API는 기본으로 제공됩니다. 합성 단말·로그인·작업이력은 demo 프로필에서 활성화됩니다. 샘플 입력은 로그인 화면에 표시됩니다. 이 요청과 애플리케이션 시작에는 DB 연결이 필요 없습니다.

## 빌드

```powershell
mvn.cmd -f src/api/pom.xml verify
cd src/web
npm.cmd ci
npm.cmd run lint
npm.cmd run build
```

백엔드 결정과 리포트 검증 기준은 [전환 설계](docs/migration.md)에 있습니다.

## 작업 문서

`git submodule update --init --recursive`로 Obsidian 서브모듈을 받은 뒤 [전환 작업 노트](docs/vault/Jeakyoung_Blog/01_Projects/09_ShinjinRework/index.md)를 엽니다.
