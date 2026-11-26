# 사원번호 출력 데모

인쇄 분류의 **사원번호 출력**을 선택하면 사용제한 대화상자가 열린다. 데모를 시작하는 프로세스에 `SHINJIN_DEMO_EMPLOYEE_PRINT_PASSWORD`를 로컬 테스트용 입력값으로 지정한다. 값이 비어 있으면 추가 인증은 통과하지 않는다. 로그인 암호와 별도로 취급하며 UI·브라우저 저장소·로그에 표시하지 않는다.

## 실행

공통 `com.shinjin.pop.output.DemoReportPrinter` 계약이 적용된 전환 작업트리를 사용한다. `src/api`에서 Java 17로 `mvn package` 후 `java -jar target/shinjin-pop-api-0.1.0-SNAPSHOT.jar --spring.profiles.active=demo --spring.config.location=optional:classpath:/`로 시작한다. Vite 개발 서버를 사용할 때는 Spring에 `--server.port=5080`을 추가한다. `src/web`에서 기존 종속성으로 `npm run build`, 개발 서버는 `npm run dev`이다.

1. 합성 단말로 로그인한다. Printer1의 합성 장치명을 검증할 때는 해당 단말 설정에서 작업지시서 프린터를 선택해 적용한다.
2. 인쇄 → 사원번호 출력 → 추가 비밀번호 확인. 최초에는 사업장과 부서를 자동 선택하지 않는다.
3. 사업장 및 필요 시 부서를 선택한다. 행을 눌러 토글하거나 ‘선택’ 헤더로 전체를 토글한다. QR 또는 바코드를 누른다.
4. 미리보기에서 돋보기 확대/축소와 페이지 이동을 사용한다. **Quick Print**는 원본 도구막대의 왼쪽에서 두 번째 프린터 아이콘이다. 공개 데모 기본값은 비활성이다. 독립 검증에서만 `shinjin.demo.employee-print-submit=true`로 실행하면 현재 단말 Printer1에 대한 합성 제출 결과가 상태줄에 표시된다. 빈 값·NONE·미등록 장치이면 출력은 422로 거절하고 접수하지 않는다. 설정을 적용한 뒤 미리보기를 새로 열어야 한다. 미리보기 닫기는 체크를 유지한다. 메뉴를 나갔다 다시 들어갈 때 추가 인증을 반복한다.

## 양식과 합성 자료

`src/api/src/main/resources/employee-print/roster.json`은 업무 로그인 자료와 독립된 검증용 명단이다. Spring은 선택 행의 부서·이름·사번을 매 요청마다 A4 밴드에 배치하고 ZXing으로 사번을 인코딩한다. 문서 페이지는 현재 추가인증 세션의 메모리에만 저장하며 재조회·닫기·메뉴 종료 시 교체·해제한다. 미리보기 이미지는 SVG다. 임의 선택이나 사원 추가에 조합별 파일을 만들 필요가 없다. 실행 중인 Spring/React는 Windows 실행 파일과 DevExpress DLL을 사용하지 않는다. 외부 테스트 명단은 서버 시작 때 `SHINJIN_DEMO_EMPLOYEE_PRINT_ROSTER=file:/절대경로/roster.json`으로 지정한다.

원본 출력 비교에만 Windows 로컬 REPORT.dll과 `NativePreview.cs`를 사용한다. `Build-Reports.ps1`의 `-FixtureDirectory`는 비교 결과를 저장할 독립 폴더를 받는다. 운영·데모 서버에 검증 실행 파일이나 원본 DLL을 설치할 필요가 없다.

## 실제 Chrome 회귀

빌드한 Spring JAR와 dist 경로를 넘긴다. 하네스가 루프백에서 새 Spring과 실제 Chrome을 시작하고 테스트 실행에만 쓰는 임의의 추가인증 값을 생성한다. 기존 웹 로그인, 메뉴에서 취소·재진입, 잘못된 암호, 미인증/미승인 요청, 사업장·부서 필터, 빈 결과, 두 양식, 출력 재전송, 선택 보존을 검사한다. 테스트 단말 설정은 이 프로세스 메모리에만 적용한다.

```powershell
node tools/employee-print/verify.mjs src/api/target/shinjin-pop-api-0.1.0-SNAPSHOT.jar src/web/dist
```

복수 페이지·새 사원 검증은 `SHINJIN_DEMO_EMPLOYEE_PRINT_ROSTER`에 이 폴더의 multipage-roster.json을 file: 경로로 지정하고 `EMPLOYEE_MULTIPAGE=1`, `EMPLOYEE_DYNAMIC=1`로 같은 하네스를 실행한다. 별도 이미지 파일 없이 24명 추가 사업장의 QR 2쪽, Code128 3쪽, 신규 사원 NEW/77을 포함한 비연속 선택을 검증한다. `EMPLOYEE_CAPTURE_DIR`에 존재하는 폴더를 지정하면 Chrome 화면과 페이지 래스터를 보존한다. ZXing core를 classpath에 넣어 `ReadSymbols.java`를 컴파일한 뒤 QR PNG, 바코드 PNG, 첫째와 둘째 사번을 넘기면 원본 좌표에서 QR 2개·Code128 4개를 각각 판독한다. 서로 다른 부서의 바코드는 보고서의 부서 순서를 따른다.

## 확인 범위

원본 미리보기에서 가져온 명령 그룹과 아이콘을 사용하고 조작 가능한 버튼은 44px 이상의 터치 영역에 배치했다. 연결한 명령은 Quick Print, 창 확대·닫기, 문서 확대·축소, 페이지 이동이다. 일반 Print...의 장치 대화상자, Open/Save, Page Setup, 파일 내보내기, 메일, 배경 등은 통합 완료 범위 밖이다. 현재 원본의 해당 아이콘과 메뉴는 연동 대기로 표시하고, 실제 실행 및 장치 연동은 별도 인수 대상이다. 원본의 Quick Print와 Print... 명령을 하나의 동작으로 합치지 않는다. 합성 출력 결과는 프린터 드라이버의 완료 통지가 아니다.
