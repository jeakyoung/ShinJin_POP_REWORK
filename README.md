# ShinJin POP Rework

신진 MES/POP의 React 및 Spring Boot 전환 프로젝트입니다. 첫 전환 기능으로 합성 로그인, 작업이력·작업지시 조회와 작업 시작·중지·재개·시작 취소·완료를 제공합니다. 작업 상태 변경은 demo 서버 메모리에만 남으며 재시작하면 초기화됩니다.

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

합성 단말·로그인·작업이력·작업지시는 `demo` 프로필에서 활성화됩니다. 로그인 화면의 톱니바퀴 **설정**에서 단말을 선택하고, 사원 로그인 전에 프린터·사업장/작업장·공정·설비·POP ID·재질·창고·POP 그룹·정보 확인 값을 편집합니다. 단말 설정은 브라우저 프로필과 선택 단말을 기준으로 로컬 파일에 보존됩니다. 샘플 자격과 업무 데이터는 메뉴에 표시하지 않습니다.

창고 설정의 별도 확인 암호까지 검증하려면 첫 번째 터미널에서 아래 방법으로 API를 시작합니다. 시험 암호와 창고 목록은 이 로컬 서버에서만 사용합니다. `demo` 단독 실행에는 창고 인증 제공자가 없어 해당 확인 요청이 503을 반환합니다.

```powershell
cd src/api
$env:POP_WAREHOUSE_TEST_PASSWORD = Read-Host '이번 로컬 창고 설정 확인 암호'
$env:POP_WAREHOUSE_TEST_CATALOG = (Resolve-Path ../../tools/equipment-settings/warehouse-catalog.tsv).Path
mvn.cmd "-Dspring-boot.run.profiles=demo,warehouse-test" spring-boot:run
```

그룹 설정을 시험할 때는 로그인 설정에서 POP A2를 선택하고 합성 사업장 P1의 작업장 005 또는 105를 저장합니다. 공정 6번을 지정하면 POP 그룹설정에서 그룹번호·공정 순서·단계별 창고와 시작/종료를 지정할 수 있습니다. 사업장 재저장 시 공정·설비·POP ID·재질·창고·그룹의 종속 선택은 원본 규칙에 따라 초기화됩니다.

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
