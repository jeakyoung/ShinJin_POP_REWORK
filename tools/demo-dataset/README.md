# POP 작업이력 데이터셋 검증

Spring Boot demo 프로필, JDK 17, Maven, Node 22 이상, Chrome을 사용한다. 아래 PowerShell 명령은 저장소 루트 기준이다. 브라우저 검증은 루프백에 독립 서버를 띄운다. 운영 데이터나 장비는 필요 없다.

```powershell
mvn -f src/api/pom.xml package
npm.cmd --prefix src/web ci
npm.cmd --prefix src/web run build
$demoJar = (Get-Item src/api/target/shinjin-pop-api-0.1.0-SNAPSHOT.jar).FullName
node tools/demo-dataset/verify.mjs $demoJar src/web/dist default
node tools/demo-dataset/verify.mjs $demoJar src/web/dist tools/demo-dataset/alternate.json
```

Chrome이 기본 Windows 경로와 다르면 `CHROME_PATH`에 실행 파일 경로를 지정한다. 수동 실행 예시는 다음과 같다.

```powershell
$data = (Get-Item tools/demo-dataset/alternate.json).FullName
java -jar $demoJar --spring.profiles.active=demo --server.address=127.0.0.1 "--shinjin.demo.dataset=$data"
```

옵션을 생략하면 클래스패스의 `work-history-default.json`을 사용한다. `new WorkHistoryFixtures()`도 같은 리소스를 사용한다. 직접 javac로 실행하는 하네스는 `src/api/src/main/resources`를 런타임 클래스패스에 포함한다. 외부 파일은 전체 교체이며 시작할 때 한 번 읽는다. 지정한 파일이 없거나 형식·소속 참조가 틀리면 시작을 중단한다.

## 데이터 계약

- `sampleDate`는 컨텍스트 및 기본 조회일이다. `terminals[].workers`의 소속이 로그인 경계다. `work`는 단말·작업자·날짜가 모두 일치하는 행을 파일 순서로 반환한다. 이력이 없는 작업자는 빈 배열을 받는다. 날짜는 ISO 형식이다.
- 선택 항목 `stations`는 단말 ID를 키로 사용한다. `center`가 005 또는 105인 인증 단말만 그룹 타일 및 API를 사용할 수 있다. `slots`는 설정된 슬롯 번호(1~6), `stages`는 순서가 있는 공정·창고 쌍이다. 그룹 설정이 비어 있으면 작업을 시작할 수 없다. 서버가 인증 단말에서 설정을 찾는다. 구 URL의 프로필을 지정해도 할당값과 다르면 403이다.
- 그룹 작업장은 메뉴로 진입한다. 다른 작업장의 단일 슬롯 6은 기존 포장 화면, 003/103의 단일 일반 슬롯은 장바구니, 그 밖의 단일 일반 슬롯은 기존 작업지시 화면으로 진입한다. 미설정·복수 슬롯은 기존 메뉴를 연다. 실제 사업장 매핑을 추가할 때는 해당 웹 업무에서 이미 허용된 단말·작업자 조합을 확인한다. 이 파일은 다른 컨트롤러의 권한 설정을 변경하지 않는다.
- 기본 데이터는 기존 단말과 작업자 ID, 소속, 날짜, 조회 결과를 유지한다. `alternate.json`은 005/105 그룹과 별도 조회일을 검증하기 위한 합성 예다. 검증기는 이 파일의 작업자 ID를 사용하여 실제 로그인 UI를 조작한다. 접속정보·암호는 JSON에 넣지 않는다.

## 검증 범위

기본 데이터로 기존 메뉴·작업 장바구니 접근·이력 1건을 확인한다. 외부 데이터로 작업자별 1건/0건, 그룹 화면의 서버 결정, 프로필 바꿔 보내기 거절, 작업자별 상태 분리, 단일 공정의 로그인 및 새로고침 진입, 타 단말 기존 메뉴를 확인한다.
